import { auth } from "./firebaseConfig.js";
import { signOut } from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  deleteDoc,
  collection
} from "firebase/firestore";
import { db } from "./firebaseConfig.js";
import Swal from "sweetalert2";
import { marked } from "marked";
import Handsontable from 'handsontable';
import 'handsontable/dist/handsontable.full.min.css';

let currentUser = null;
let baseConversation = [];
let userConversation = [];
let selectedScenarioId = null;
let hot; // handsontable 인스턴스

document.addEventListener("DOMContentLoaded", () => {
  // undoBtn을 선택적으로 가져오기
  const undoBtn = document.getElementById("undo-btn");
  const feedbackBtn = document.getElementById("feedbackBtn");
  const inputText = document.getElementById("inputText");

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      document.getElementById("userInfo").textContent = `👤 ${user.displayName} 님`;
      document.getElementById("logoutBtn").style.display = 'inline-block';
      await loadScenario();
      await loadUserSavedResults();
      await checkFeedbackSettings();
    } else {
      document.getElementById("userInfo").textContent = '🔐 로그인 후 이용해 주세요.';
      document.getElementById("logoutBtn").style.display = 'none';
      Swal.fire({
        icon: "warning",
        title: "로그인이 필요합니다",
        text: "메인 페이지로 이동합니다.",
        confirmButtonText: "확인",
      }).then(() => {
        window.location.href = "/index.html";
      });
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "/index.html";
  });

  // undoBtn이 존재할 때만 이벤트 리스너 추가
  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      if (userConversation.length > 0) {
        userConversation.pop();
        renderExcelTable();
      }
    });
  }

  // 피드백 받기 버튼 이벤트 (대화문 + 피드백 저장)
  feedbackBtn.addEventListener("click", async () => {
    // 현재 Handsontable의 모든 데이터를 가져와서 중복 없이 구성
    const currentData = hot.getData();
    const allConv = [];
    
    // baseConversation 길이만큼은 제시된 대화문 (isUser: false)
    for (let i = 0; i < baseConversation.length; i++) {
      const row = currentData[i];
      if (row[0]?.trim() && row[1]?.trim()) {
        allConv.push({
          speaker: row[0].trim(),
          message: row[1].trim(),
          isUser: false
        });
      }
    }
    
    // baseConversation 이후는 사용자 입력 (isUser: true)
    for (let i = baseConversation.length; i < currentData.length; i++) {
      const row = currentData[i];
      if (row[0]?.trim() && row[1]?.trim()) {
        allConv.push({
          speaker: row[0].trim(),
          message: row[1].trim(),
          isUser: true
        });
      }
    }
    
    if (allConv.length === 0) {
      Swal.fire({
        icon: "warning",
        title: "대화 입력 필요",
        text: "대화를 입력해 주세요."
      });
      return;
    }
    const conversationText = allConv.map(e => `${e.speaker}: ${e.message}`).join("\n");
    inputText.value = conversationText;

    feedbackBtn.disabled = true;
    document.getElementById("result").innerHTML = "⏳ 피드백 생성 중...";

    try {
      const feedback = await getAssistantFeedback(conversationText);
      document.getElementById("result").innerHTML = marked.parse(feedback);
      if (window.MathJax) MathJax.typeset();

      if (currentUser) {
        const timestamp = new Date();
        const docId = `${currentUser.uid}_lessonPlayFeedback_${timestamp.getTime()}`;
        await setDoc(doc(db, "lessonPlayResponses", docId), {
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          email: currentUser.email,
          scenarioId: selectedScenarioId,
          createdAt: serverTimestamp(),
          type: 'feedback', // 피드백 타입 구분
          conversation: allConv,
          feedback: feedback
        });

        Swal.fire({
          icon: "success",
          title: "피드백 제출 완료",
          text: "대화와 GPT 피드백이 제출되었습니다!"
        });

        // 새 카드 위에 추가
        renderSavedResult({
          id: docId,
          createdAt: timestamp,
          type: 'feedback',
          conversation: allConv,
          feedback
        });

        userConversation = [];
        renderExcelTable();
      }
    } catch (err) {
      console.error("피드백 오류:", err);
      document.getElementById("result").textContent = "⚠️ 피드백 생성에 실패했습니다.";
      Swal.fire({
        icon: "error",
        title: "피드백 실패",
        text: "GPT 피드백을 생성하거나 저장하는 데 실패했습니다."
      });
    }
    feedbackBtn.disabled = false;
  });

  // Handsontable 초기화
  createExcelTable();
  
  // 폰트 적용 상태 확인
  setTimeout(() => {
    console.log('폰트 적용 상태 확인:', {
      bodyFont: getComputedStyle(document.body).fontFamily,
      tableFont: getComputedStyle(document.getElementById('excel-table')).fontFamily
    });
  }, 1000);
  
  // 행 추가/삭제 버튼 이벤트
  document.getElementById('add-row').onclick = () => {
    // 행 추가는 항상 맨 마지막에 추가 (커서 위치와 무관)
    try {
      hot.alter('insert_row', hot.countRows(), 1);
    } catch (e) {
      try {
        hot.alter('insert_row_below', hot.countRows() - 1, 1);
      } catch (e2) {
        alert("Handsontable 버전 호환 문제가 있습니다.");
      }
    }
  };
  
  document.getElementById('del-row').onclick = () => {
    const sel = hot.getSelected();
    if (sel && sel.length > 0) {
      const selectedRow = sel[0][0];
      // 제시된 대화문은 삭제 불가
      if (selectedRow < baseConversation.length) {
        Swal.fire("⚠️ 알림", "제시된 대화문은 삭제할 수 없습니다.", "warning");
        return;
      }
      // 사용자가 추가한 행만 삭제 가능
      hot.alter('remove_row', selectedRow);
    }
  };

  // 확장/축소 버튼 이벤트
  document.getElementById('expand-toggle').addEventListener('click', () => {
    const table = document.getElementById('excel-table');
    const button = document.getElementById('expand-toggle');
    
    if (table.classList.contains('expanded')) {
      // 축소
      table.classList.remove('expanded');
      button.textContent = '📏 확장';
      button.classList.remove('expanded');
      button.title = '테이블 확장';
    } else {
      // 확장
      table.classList.add('expanded');
      button.textContent = '📏 축소';
      button.classList.add('expanded');
      button.title = '테이블 축소';
    }
  });

  // 제출 버튼 이벤트 (대화문만 저장)
  document.getElementById('submit-btn').addEventListener('click', async () => {
    if (!currentUser) {
      Swal.fire({
        icon: "warning",
        title: "로그인 필요",
        text: "로그인이 필요합니다."
      });
      return;
    }

    // 현재 Handsontable에서 사용자 입력이 있는지 확인
    const currentData = hot.getData();
    let hasUserInput = false;
    
    for (let i = baseConversation.length; i < currentData.length; i++) {
      const row = currentData[i];
      if (row[0]?.trim() && row[1]?.trim()) {
        hasUserInput = true;
        break;
      }
    }
    
    if (!hasUserInput) {
      Swal.fire({
        icon: "warning",
        title: "대화 입력 필요",
        text: "사용자 대화를 입력해 주세요."
      });
      return;
    }

    if (!selectedScenarioId) {
      Swal.fire("❌ 시나리오 없음", "저장할 시나리오가 선택되지 않았습니다.", "error");
      return;
    }

    const timestamp = new Date();
    const docId = `${currentUser.uid}_lessonPlay_${timestamp.getTime()}`;

    try {
      // 현재 Handsontable의 모든 데이터를 가져와서 중복 없이 구성
      const currentData = hot.getData();
      const allConv = [];
      
      // baseConversation 길이만큼은 제시된 대화문 (isUser: false)
      for (let i = 0; i < baseConversation.length; i++) {
        const row = currentData[i];
        if (row[0]?.trim() && row[1]?.trim()) {
          allConv.push({
            speaker: row[0].trim(),
            message: row[1].trim(),
            isUser: false
          });
        }
      }
      
      // baseConversation 이후는 사용자 입력 (isUser: true)
      for (let i = baseConversation.length; i < currentData.length; i++) {
        const row = currentData[i];
        if (row[0]?.trim() && row[1]?.trim()) {
          allConv.push({
            speaker: row[0].trim(),
            message: row[1].trim(),
            isUser: true
          });
        }
      }

      await setDoc(doc(db, "lessonPlayResponses", docId), {
        uid: currentUser.uid,
        displayName: currentUser.displayName,
        email: currentUser.email,
        createdAt: serverTimestamp(),
        scenarioId: selectedScenarioId,
        type: 'conversation', // 제출 타입 구분
        conversation: allConv
      });

      Swal.fire("✅ 제출 완료", "대화가 제출되었습니다.", "success");

      // 화면에 결과 추가
      renderSavedResult({
        id: docId,
        createdAt: timestamp,
        type: 'conversation',
        conversation: allConv
      });

      userConversation = [];
      renderExcelTable();
    } catch (err) {
      console.error("제출 실패:", err);
      Swal.fire("❌ 제출 실패", "다시 시도해주세요.", "error");
    }
  });
});

// Handsontable 생성 함수
function createExcelTable() {
  const container = document.getElementById('excel-table');
  hot = new Handsontable(container, {
    data: [['', '']], // 빈 데이터로 시작
    colHeaders: ['발화자', '대화'],
    rowHeaders: true,
    contextMenu: true,
    colWidths: [120, 300], // 발화자 열 너비 증가
    minRows: 2,
    minCols: 2,
    licenseKey: 'non-commercial-and-evaluation',
    width: '100%',
    height: 'auto',
    stretchH: 'all',
    manualRowResize: true,
    manualColumnResize: true,
    autoWrapRow: true,
    autoWrapCol: true,
    autoRowSize: true,
    outsideClickDeselects: false,
    rowHeights: 50, // 행 높이 증가
    className: 'custom-handsontable',
    cells: function(row, col, prop) {
      // 기본 대화(서버 제공)는 읽기 전용으로 설정
      if (row < baseConversation.length) {
        return { readOnly: true };
      }
      // 사용자 입력 대화는 편집 가능
      return { readOnly: false };
    },
    afterChange: function(changes, source) {
      if (source === 'edit') {
        updateUserConversation();
      }
    },
    // 첫 번째 열(발화자) 정렬 설정
    columns: [
      { data: 0, className: 'htCenter' },
      { data: 1, className: 'htLeft' }
    ]
  });
}

// Handsontable 데이터를 userConversation으로 변환 (실제로는 사용하지 않음)
function updateUserConversation() {
  // 이 함수는 더 이상 실제로 사용되지 않습니다.
  // 저장할 때 직접 Handsontable에서 데이터를 가져옵니다.
  console.log("updateUserConversation called - but not used for storage");
}

// Handsontable에 데이터 렌더링
function renderExcelTable() {
  const allData = [
    ...baseConversation.map(e => [e.speaker, e.message]),
    ...userConversation.map(e => [e.speaker, e.message])
  ];
  
  // 최소 2행 유지
  if (allData.length < 2) {
    allData.push(['', '']);
  }
  
  hot.loadData(allData);
  
  // 기본 대화 행들을 읽기 전용으로 설정
  for (let i = 0; i < baseConversation.length; i++) {
    hot.setCellMeta(i, 0, 'readOnly', true);
    hot.setCellMeta(i, 1, 'readOnly', true);
  }
  
  // 사용자가 추가한 행들에 user-added-row 클래스 적용
  for (let i = baseConversation.length; i < hot.countRows(); i++) {
    hot.setCellMeta(i, 0, 'className', 'user-added-row');
    hot.setCellMeta(i, 1, 'className', 'user-added-row');
  }
  
  // 테이블 새로고침
  hot.render();
}

// 🎛️ 피드백 설정 확인 및 UI 업데이트
async function checkFeedbackSettings() {
  try {
    const feedbackDoc = await getDoc(doc(db, "lessonPlaySettings", "feedback"));
    const pageContainer = document.querySelector('.page-container');
    
    if (feedbackDoc.exists()) {
      const data = feedbackDoc.data();
      if (data.enabled) {
        // 피드백 기능 활성화
        pageContainer.classList.remove('feedback-disabled');
      } else {
        // 피드백 기능 비활성화
        pageContainer.classList.add('feedback-disabled');
      }
    } else {
      // 기본값: 비활성화
      pageContainer.classList.add('feedback-disabled');
    }
  } catch (error) {
    console.error("피드백 설정 확인 실패:", error);
    // 오류 시 기본값으로 비활성화
    document.querySelector('.page-container').classList.add('feedback-disabled');
  }
}

// 🔵 시나리오 불러오기 및 초기화
async function loadScenario() {
  try {
    const configDoc = await getDoc(doc(db, "lessonPlayScenarios", "config"));
    const selectedId = configDoc.exists() ? configDoc.data().selectedScenarioId : null;
    if (!selectedId) throw new Error("선택된 시나리오 ID가 없습니다.");
    selectedScenarioId = selectedId;

    const scenarioDoc = await getDoc(doc(db, "lessonPlayScenarios", selectedScenarioId));
    if (!scenarioDoc.exists()) throw new Error("선택된 시나리오 문서를 찾을 수 없습니다.");
    const scenarioData = scenarioDoc.data();

    document.querySelector(".scenario-description").textContent = scenarioData.scenarioText || "";

    baseConversation = [];
    userConversation = [];
    if (Array.isArray(scenarioData.starterConversation)) {
      scenarioData.starterConversation.forEach(entry => {
        baseConversation.push(entry);
      });
    }
    renderExcelTable();
  } catch (error) {
    console.error("시나리오 로딩 실패:", error);
    Swal.fire("시나리오 로딩 실패", error.message, "error");
  }
}



// 🔵 Firestore에서 내 저장 결과 모두 불러와 2열로 구분해서 보여주기
async function loadUserSavedResults() {
  const snapshot = await getDocs(collection(db, "lessonPlayResponses"));
  const container = document.getElementById("saved-results-container");
  container.innerHTML = "";

  // 제출 결과와 피드백 결과를 분리
  const conversationResults = [];
  const feedbackResults = [];
  
  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (
      data.uid === currentUser.uid &&
      data.scenarioId === selectedScenarioId &&
      data.conversation
    ) {
      const createdAt = data.createdAt?.toDate?.() || new Date();
      const result = {
        id: docSnap.id,
        createdAt,
        conversation: data.conversation,
        feedback: data.feedback
      };
      
      if (data.type === 'feedback') {
        feedbackResults.push(result);
      } else {
        conversationResults.push(result);
      }
    }
  });
  
  // 최신순 내림차순 정렬
  conversationResults.sort((a, b) => b.createdAt - a.createdAt);
  feedbackResults.sort((a, b) => b.createdAt - a.createdAt);
  
  // 2열 레이아웃으로 결과 표시
  renderResultsInColumns(conversationResults, feedbackResults);
}

// 🔵 2열 레이아웃으로 결과 표시
function renderResultsInColumns(conversationResults, feedbackResults) {
  const container = document.getElementById("saved-results-container");
  
  // 2열 레이아웃 컨테이너 생성 - 간단하게
  const columnsContainer = document.createElement("div");
  columnsContainer.classList.add("results-columns");
  
  // 제출 결과 열 (왼쪽)
  const leftColumn = document.createElement("div");
  leftColumn.classList.add("results-column", "conversation-column");
  leftColumn.innerHTML = `
    <h3 class="column-title">💬 제출된 대화문</h3>
    <div class="column-content"></div>
  `;
  
  // 피드백 결과 열 (오른쪽)
  const rightColumn = document.createElement("div");
  rightColumn.classList.add("results-column", "feedback-column");
  rightColumn.innerHTML = `
    <h3 class="column-title">📝 피드백 받은 대화문</h3>
    <div class="column-content"></div>
  `;
  
  // 제출 결과 렌더링
  const leftContent = leftColumn.querySelector(".column-content");
  if (conversationResults.length === 0) {
    leftContent.innerHTML = '<p class="no-results">아직 제출된 대화문이 없습니다.</p>';
  } else {
    conversationResults.forEach(result => {
      leftContent.appendChild(renderSavedResult(result, 'conversation'));
    });
  }
  
  // 피드백 결과 렌더링
  const rightContent = rightColumn.querySelector(".column-content");
  if (feedbackResults.length === 0) {
    rightContent.innerHTML = '<p class="no-results">아직 피드백을 받은 대화문이 없습니다.</p>';
  } else {
    feedbackResults.forEach(result => {
      rightContent.appendChild(renderSavedResult(result, 'feedback'));
    });
  }
  
  // 컨테이너에 추가
  columnsContainer.appendChild(leftColumn);
  columnsContainer.appendChild(rightColumn);
  container.appendChild(columnsContainer);
}

// 🔵 카드로 저장 결과 출력 (수정됨)
function renderSavedResult({ id, createdAt, conversation, feedback }, type = 'conversation') {
  const box = document.createElement("div");
  box.classList.add("saved-result", `result-${type}`);
  box.setAttribute("data-id", id);

  const header = document.createElement("div");
  header.classList.add("saved-header");
  
  // 타입에 따른 아이콘과 텍스트 (클릭 가능하도록 수정) - 기본적으로 접혀있으므로 ▶ 사용
  if (type === 'feedback') {
    header.innerHTML = `<span class="header-text" onclick="toggleResult(this)">📝 ${createdAt.toLocaleString('ko-KR')} 피드백 제출됨 ▶</span>`;
  } else {
    header.innerHTML = `<span class="header-text" onclick="toggleResult(this)">💬 ${createdAt.toLocaleString('ko-KR')} 제출됨 ▶</span>`;
  }

  // 불러오기 버튼 추가
  const loadBtn = document.createElement("button");
  loadBtn.classList.add("load-btn");
  loadBtn.textContent = "불러오기";
  loadBtn.onclick = () => loadSavedResult(conversation, box);
  
  const delBtn = document.createElement("button");
  delBtn.classList.add("delete-btn");
  delBtn.textContent = "삭제";
  delBtn.onclick = () => deleteSavedResult(id, box);
  
  header.appendChild(loadBtn);
  // header.appendChild(delBtn);
  box.appendChild(header);

  // 내용을 result-content로 감싸기
  const contentDiv = document.createElement("div");
  contentDiv.classList.add("result-content");
  contentDiv.style.display = "none"; // 기본적으로 접혀있음

  // 대화문을 테이블 형식으로 표시
  const conversationTable = document.createElement("div");
  conversationTable.classList.add("conversation-table");
  
  conversation.forEach(entry => {
    const row = document.createElement("div");
    row.classList.add("conversation-row");
    if (entry.isUser) row.classList.add("user-entry");
    
    const speaker = document.createElement("span");
    speaker.classList.add("speaker");
    speaker.textContent = entry.speaker;
    
    const message = document.createElement("span");
    message.classList.add("message");
    message.textContent = entry.message;
    
    row.appendChild(speaker);
    row.appendChild(message);
    conversationTable.appendChild(row);
  });
  
  contentDiv.appendChild(conversationTable);

  // 피드백이 있는 경우에만 표시
  if (feedback && type === 'feedback') {
    const feedbackBox = document.createElement("div");
    feedbackBox.classList.add("feedback-area");
    feedbackBox.innerHTML = marked.parse(feedback);
    contentDiv.appendChild(feedbackBox);
  }

  box.appendChild(contentDiv);

  return box;
}

// 🔵 저장된 결과 불러오기
function loadSavedResult(conversation, domElement) {
  try {
    // 현재 Handsontable 데이터 초기화
    const allData = [];
    
    // 제시된 대화문은 그대로 유지
    for (let i = 0; i < baseConversation.length; i++) {
      allData.push([baseConversation[i].speaker, baseConversation[i].message]);
    }
    
    // 저장된 사용자 대화문 추가
    conversation.forEach(entry => {
      if (entry.isUser) {
        allData.push([entry.speaker, entry.message]);
      }
    });
    
    // 최소 2행 유지
    if (allData.length < 2) {
      allData.push(['', '']);
    }
    
    // Handsontable에 데이터 로드
    hot.loadData(allData);
    
    // 기본 대화 행들을 읽기 전용으로 설정
    for (let i = 0; i < baseConversation.length; i++) {
      hot.setCellMeta(i, 0, 'readOnly', true);
      hot.setCellMeta(i, 1, 'readOnly', true);
    }
    
    // 사용자가 추가한 행들에 user-added-row 클래스 적용
    for (let i = baseConversation.length; i < hot.countRows(); i++) {
      hot.setCellMeta(i, 0, 'className', 'user-added-row');
      hot.setCellMeta(i, 1, 'className', 'user-added-row');
    }
    
    // 테이블 새로고침
    hot.render();
    
    // 성공 메시지 표시
    Swal.fire({
      icon: "success",
      title: "불러오기 완료",
      text: "저장된 대화문이 입력창에 불러와졌습니다!",
      timer: 2000,
      showConfirmButton: false
    });
    
  } catch (error) {
    console.error("불러오기 실패:", error);
    Swal.fire({
      icon: "error",
      title: "불러오기 실패",
      text: "대화문을 불러오는 중 오류가 발생했습니다."
    });
  }
}

// 🔵 결과 카드 토글 (접기/펼치기) - 전역 함수로 등록
window.toggleResult = function(headerElement) {
  const resultCard = headerElement.closest('.saved-result');
  const content = resultCard.querySelector('.result-content');
  const isExpanded = content.style.display !== 'none';
  
  if (isExpanded) {
    // 접기
    content.style.display = 'none';
    headerElement.innerHTML = headerElement.innerHTML.replace(' ▼', ' ▶');
  } else {
    // 펼치기
    content.style.display = 'block';
    headerElement.innerHTML = headerElement.innerHTML.replace(' ▶', ' ▼');
  }
};

// 🔵 카드 삭제
async function deleteSavedResult(docId, domElement) {
  const result = await Swal.fire({
    title: "정말 삭제하시겠습니까?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "삭제",
    cancelButtonText: "취소"
  });
  if (!result.isConfirmed) return;

  try {
    await deleteDoc(doc(db, "lessonPlayResponses", docId));
    domElement.remove();
    Swal.fire({
      icon: "success",
      title: "삭제 완료",
      text: "카드가 삭제되었습니다!"
    });
  } catch (err) {
    console.error("삭제 실패:", err);
    Swal.fire({
      icon: "error",
      title: "삭제 실패",
      text: "삭제 중 오류가 발생했습니다."
    });
  }
}


// 🔵 GPT Assistant 피드백 생성 함수 (page1과 동일)
const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
const assistantId = import.meta.env.VITE_OPENAI_ASSISTANT_ID;

// 환경 변수 디버깅
console.log('OpenAI API Key:', apiKey ? '설정됨' : '설정되지 않음');
console.log('OpenAI Assistant ID:', assistantId ? '설정됨' : '설정되지 않음');

// 환경 변수 검증
if (!apiKey || !assistantId) {
  console.error('OpenAI 환경 변수가 설정되지 않았습니다!');
  console.error('VITE_OPENAI_API_KEY:', apiKey);
  console.error('VITE_OPENAI_ASSISTANT_ID:', assistantId);
}
const feedbackPrompt = `
다음은 교사와 학생의 대화 또는 수업 기록입니다. 
첨부한 문서에 수록된 TMSSR Framework의 내용을 바탕으로, 사용자와 가상의 학생 사이에 이루어진 대화를 분석하여 피드백을 제공해줘.
표 형태로 정리해줘도 좋을 것 같아

피드백에는 다음이 반드시 포함되어야 해:
1. TMSSR Framework의 네 가지 요소(Eliciting, Responding, Facilitating, Extending)에 따라 교사의 발화나 상호작용을 분류하고 해석할 것
2. 교사의 발문이나 피드백 방식이 학생의 수학적 사고에 어떤 영향을 미치는지 평가할 것
3. TMSSR Framework를 바탕으로 더 효과적인 교수 전략을 구체적으로 제안할 것

중요:
- 피드백은 반드시 **마크다운 형식**으로 작성해줘
- 학생과 교사의 대화를 그대로 반복하거나 인용하지 말고, 핵심 내용을 요약하고 분석 중심으로 작성해줘
- 첨부된 문서의 내용을 참고하여 TMSSR Framework에 기반한 분석을 명확히 반영해줘
`;

async function getAssistantFeedback(userText) {
  // 환경 변수 검증
  if (!apiKey || !assistantId) {
    throw new Error('OpenAI API 키 또는 Assistant ID가 설정되지 않았습니다. .env 파일을 확인해주세요.');
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "OpenAI-Beta": "assistants=v2"
  };

  const threadRes = await fetch("https://api.openai.com/v1/threads", {
    method: "POST", headers
  });
  const threadData = await threadRes.json();
  const threadId = threadData.id;

  await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
    method: "POST", headers,
    body: JSON.stringify({
      role: "user",
      content: `${feedbackPrompt}\n\n${userText}`
    })
  });

  const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    method: "POST", headers,
    body: JSON.stringify({
      assistant_id: assistantId,
      instructions: "출력은 반드시 한국어 마크다운 형식으로 작성해주세요."
    })
  });
  const runData = await runRes.json();
  const runId = runData.id;

  let status = runData.status;
  while (status !== "completed") {
    await new Promise(r => setTimeout(r, 1000));
    const statusRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, { headers });
    const statusData = await statusRes.json();
    status = statusData.status;
    if (status === "failed") throw new Error("GPT 실행 실패");
  }

  const messagesRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, { headers });
  const messagesData = await messagesRes.json();
  const assistantMessages = messagesData.data.filter(msg => msg.role === "assistant");
  return assistantMessages.map(m => m.content[0].text.value).join("\n").replace(/【.*?†.*?】/g, '');
}

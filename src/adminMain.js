// 🔗 Firebase SDK에서 필요한 함수들 가져오기
import { getFirestore, doc, getDoc, collection, getDocs, setDoc, deleteDoc } from "firebase/firestore";
import { marked } from 'marked';
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./firebaseConfig.js";

// SweetAlert2 import (CDN 사용 시 이 줄 필요 없음)
import Swal from 'sweetalert2';

// ✅ 관리자 권한 UID 설정
const allowedAdmins = ["MhtH5gvH0RMv4yogqP4Tj6ki4Tp1"];

// 🔧 DOM 요소 참조
const userSelect = document.getElementById("user-select");
const activitySelect = document.getElementById("activity-select");
const scenarioSelect = document.getElementById("scenario-select");
const dateSelect = document.getElementById("date-select");
const resultsContainer = document.getElementById("results-container");

const scenarioTextArea = document.getElementById("scenario-text");
const starterSpeaker = document.getElementById("starter-speaker");
const starterMessage = document.getElementById("starter-message");
const addStarterBtn = document.getElementById("add-starter-btn");

starterMessage.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();   // 줄바꿈 막기 (textarea가 아니니까 없어도 됨)
    addStarterBtn.click(); // 버튼 클릭 효과
  }
});

const starterList = document.getElementById("starter-conversation-list");
const saveScenarioBtn = document.getElementById("save-scenario-btn");

let allUsers = [];
let allScenarios = [];
let starterConversation = [];  // 초기 대화 저장 배열
let todayString = new Date().toISOString().split("T")[0]; // 오늘 날짜 (YYYY-MM-DD)
let selectedScenarioId = null; // 시나리오 id 저장

// 🔐 로그인 확인 및 관리자 권한 검증
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (user) => {
    if (user && allowedAdmins.includes(user.uid)) {
      initAdminPage();
      loadScenarioList(); // 시나리오 목록 불러오기
    } else {
      Swal.fire({
        icon: 'error',
        title: '접근 불가',
        text: '접근 권한이 없습니다.'
      }).then(() => window.location.href = "/");
    }
  });
});

// 🔄 관리자 페이지 초기화
async function initAdminPage() {
  await loadAllUsers();
  await loadAllScenarios();
  await populateDate();

  userSelect.addEventListener("change", filterAndRender);
  activitySelect.addEventListener("change", filterAndRender);
  scenarioSelect.addEventListener("change", filterAndRender);
  dateSelect.addEventListener("change", async () => {
    await loadAllUsers();
    filterAndRender();
  });

  filterAndRender(); // 초기 렌더링
}

// 🔍 Firestore에서 유저 목록 로드
async function loadAllUsers() {
  const selectedDate = dateSelect.value;
  const snapshot = await getDocs(collection(db, "lessonPlayResponses"));
  const userMap = new Map();

  snapshot.forEach(doc => {
    const data = doc.data();
    const dateStr = data.createdAt?.toDate?.().toISOString().split("T")[0];
    if (dateStr === selectedDate && data.uid) {
      const displayName = data.displayName || data.uid;
      if (!userMap.has(data.uid)) {
        userMap.set(data.uid, displayName);
      }
    }
  });

  allUsers = Array.from(userMap.entries()).map(([uid, name]) => ({ uid, name }));

  // 사용자 드롭다운 구성
  userSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "전체 사용자 보기";
  userSelect.appendChild(allOption);

  allUsers.forEach(user => {
    const option = document.createElement("option");
    option.value = user.uid;
    option.textContent = user.name;
    userSelect.appendChild(option);
  });
}

// 🔍 Firestore에서 시나리오 목록 로드
async function loadAllScenarios() {
  allScenarios = [];
  scenarioSelect.innerHTML = "";
  const snapshot = await getDocs(collection(db, "lessonPlayScenarios"));
  snapshot.forEach(doc => {
    if (doc.id !== "config") {
      allScenarios.push({ id: doc.id, title: doc.data().title || "새로 입력하기" });
    }
  });

  allScenarios.forEach(s => {
    const option = document.createElement("option");
    option.value = s.id;
    option.textContent = s.title;
    scenarioSelect.appendChild(option);
  });
}

// 📅 날짜 입력 기본값 설정
function populateDate() {
  dateSelect.value = todayString;
}

// 🔍 선택된 조건으로 결과 필터링 및 렌더링
async function filterAndRender() {
  const uid = userSelect.value;
  const activity = activitySelect.value;
  const scenarioId = scenarioSelect.value;
  const selectedDate = dateSelect.value;

  resultsContainer.innerHTML = "";

  const filteredUsers = uid === "all" ? allUsers : allUsers.filter(u => u.uid === uid);
  const snapshot = await getDocs(collection(db, "lessonPlayResponses"));

  for (const user of filteredUsers) {
    const matchedDocs = snapshot.docs.filter(docSnap => {
      const data = docSnap.data();
      const created = data.createdAt?.toDate?.().toISOString().split("T")[0];
      return (
        data.uid === user.uid &&
        data.scenarioId === scenarioId &&
        created === selectedDate &&
        docSnap.id.includes(activity)
      );
    });

    matchedDocs.forEach(docSnap => {
      const data = docSnap.data();
      const box = document.createElement("div");
      box.classList.add("user-result");

      const name = document.createElement("div");
      name.classList.add("user-name");
      name.textContent = `사용자: ${user.name}`;
      box.appendChild(name);

      box.appendChild(renderPageBox(`활동 ${activity.slice(-1)}`, data, activity));
      resultsContainer.appendChild(box);
    });
  }
}

// 🧩 활동 결과 박스 생성
function renderPageBox(title, data, pageKey) {
  const box = document.createElement("div");
  box.classList.add(pageKey, "page-box");

  const pageTitle = document.createElement("div");
  pageTitle.classList.add("page-title");

  let formattedTime = "";
  if (data?.createdAt?.toDate) {
    const date = data.createdAt.toDate();
    formattedTime = ` (${date.toLocaleString('ko-KR')})`;
  }

  pageTitle.textContent = `${title}${formattedTime}`;
  box.appendChild(pageTitle);

  if (pageKey === "page2") {
    const conv = document.createElement("div");
    conv.style.whiteSpace = "pre-wrap";
    conv.style.backgroundColor = "#fff";
    conv.style.padding = "10px";
    conv.style.borderRadius = "8px";
    conv.style.marginBottom = "1rem";

    const lines = (data.conversation || "").split('\n').map(line =>
      line.startsWith("👩‍🏫") ? `<span class="teacher-line">${line}</span>` : line
    );

    conv.innerHTML = lines.join('<br>');
    box.appendChild(conv);

    const feedback = document.createElement("div");
    feedback.innerHTML = marked.parse(data.feedback || "(피드백 없음)");
    box.appendChild(feedback);

  } else if (Array.isArray(data.conversation)) {
    data.conversation.forEach(entry => {
      const p = document.createElement("p");
      p.innerHTML = `<strong>${entry.speaker}:</strong> ${entry.message}`;
      if (entry.isUser) {
        p.classList.add("user-highlight");
      }
      box.appendChild(p);
    });
  } else {
    box.innerHTML += "<p><em>대화 없음</em></p>";
  }

  return box;
}

// ➕ 초기 대화 추가
addStarterBtn.addEventListener("click", () => {
  const speaker = starterSpeaker.value.trim();
  const message = starterMessage.value.trim();
  if (!speaker || !message) return;

  starterConversation.push({ speaker, message });
  renderStarterList();

  starterSpeaker.value = "";
  starterMessage.value = "";
  starterSpeaker.focus();
});

// 🔄 초기 대화 리스트 렌더링
function renderStarterList() {
  starterList.innerHTML = "";
  starterConversation.forEach((entry, idx) => {
    const p = document.createElement("p");
    p.innerHTML = `<strong>${entry.speaker}:</strong> ${entry.message} 
     <button onclick="removeStarter(${idx})" class="btn btn-delete" style="margin-left:10px;">❌</button>`;
    starterList.appendChild(p);
  });
}

// ❌ 초기 대화 항목 제거
window.removeStarter = function(idx) {
  starterConversation.splice(idx, 1);
  renderStarterList();
};

// 💾 시나리오 저장 (새로 저장만 가능)
saveScenarioBtn.addEventListener("click", async () => {
  const title = document.getElementById("scenario-title").value.trim();
  const text = scenarioTextArea.value.trim();

  if (!title || !text) {
    Swal.fire({
      icon: 'warning',
      title: '입력 필요',
      text: '제목과 시나리오 내용을 모두 입력하세요.'
    });
    return;
  }

  const docId = `scenario_${Date.now()}`;  // 새 ID 생성

  try {
    await setDoc(doc(db, "lessonPlayScenarios", docId), {
      title,
      scenarioText: text,
      starterConversation
    });

    Swal.fire({
      icon: 'success',
      title: '저장 완료',
      text: '✅ 시나리오가 저장되었습니다!'
    });
    selectedScenarioId = null;
    document.getElementById("update-scenario-btn").disabled = true;
    document.getElementById("delete-scenario-btn").disabled = true;
    document.getElementById("scenario-title").value = "";
    scenarioTextArea.value = "";
    starterConversation = [];
    renderStarterList();
    await loadAllScenarios();
    await loadScenarioList();
  } catch (err) {
    console.error("❌ 저장 실패:", err);
    Swal.fire({
      icon: 'error',
      title: '저장 실패',
      text: '❌ 저장 실패. 콘솔을 확인하세요.'
    });
  }
});

// 📄 시나리오 목록 버튼 생성
async function loadScenarioList() {
  const listContainer = document.getElementById("scenario-list");
  listContainer.innerHTML = "";

  const snapshot = await getDocs(collection(db, "lessonPlayScenarios"));
  snapshot.forEach(docSnap => {
    if (docSnap.id === "config") return; // 💡 config 제외!
    const data = docSnap.data();
    const button = document.createElement("button");
    button.textContent = data.title || "새로 입력하기";
    button.classList.add("nav-button");
    button.style.marginRight = "10px";
    button.onclick = async () => {
      scenarioTextArea.value = data.scenarioText || "";
      starterConversation = data.starterConversation || [];
      renderStarterList();
      document.getElementById("scenario-title").value = data.title || "";
      selectedScenarioId = docSnap.id; // ⭐️ 반드시 추가

      try {
        await setDoc(doc(db, "lessonPlayScenarios", "config"), {
          selectedScenarioId: docSnap.id,
        }, { merge: true });
        // 버튼 활성화
        document.getElementById("update-scenario-btn").disabled = false;
        document.getElementById("delete-scenario-btn").disabled = false;
      } catch (err) {
        console.error("❌ 선택 ID 저장 실패:", err);
      }
    };
    listContainer.appendChild(button);
  });
}

// 🎛️ 시나리오 편집기 열기/닫기 토글
document.getElementById("toggle-scenario-editor").addEventListener("click", () => {
  const editor = document.querySelector(".scenario-editor");
  const btn = document.getElementById("toggle-scenario-editor");

  if (editor.classList.contains("hidden")) {
    editor.classList.remove("hidden");
    btn.textContent = "❌ 시나리오 설정 닫기";
  } else {
    editor.classList.add("hidden");
    btn.textContent = "🛠️ 시나리오 설정 열기";
  }
});

// 📝 시나리오 수정
document.getElementById("update-scenario-btn").addEventListener("click", async () => {
  if (!selectedScenarioId) {
    Swal.fire({
      icon: 'info',
      title: '알림',
      text: '수정할 시나리오를 먼저 선택하세요!'
    });
    return;
  }
  const title = document.getElementById("scenario-title").value.trim();
  const text = scenarioTextArea.value.trim();
  if (!title || !text) {
    Swal.fire({
      icon: 'warning',
      title: '입력 필요',
      text: '제목과 시나리오 내용을 모두 입력하세요.'
    });
    return;
  }
  try {
    await setDoc(doc(db, "lessonPlayScenarios", selectedScenarioId), {
      title,
      scenarioText: text,
      starterConversation
    }, { merge: true }); // 기존 문서에 덮어쓰기(갱신)
    Swal.fire({
      icon: 'success',
      title: '수정 완료',
      text: '✅ 시나리오 수정 완료!'
    });
    await loadAllScenarios();
    await loadScenarioList();
  } catch (err) {
    console.error("❌ 수정 실패:", err);
    Swal.fire({
      icon: 'error',
      title: '수정 실패',
      text: '❌ 수정 실패. 콘솔을 확인하세요.'
    });
  }
});

// 🗑️ 시나리오 삭제
document.getElementById("delete-scenario-btn").addEventListener("click", async () => {
  if (!selectedScenarioId) {
    Swal.fire({
      icon: 'info',
      title: '알림',
      text: '삭제할 시나리오를 먼저 선택하세요!'
    });
    return;
  }
  const result = await Swal.fire({
    title: '정말 삭제하시겠습니까?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: '삭제',
    cancelButtonText: '취소'
  });
  if (!result.isConfirmed) return;

  try {
    await deleteDoc(doc(db, "lessonPlayScenarios", selectedScenarioId));
    Swal.fire({
      icon: 'success',
      title: '삭제 완료',
      text: '✅ 시나리오 삭제 완료!'
    });
    selectedScenarioId = null;
    document.getElementById("update-scenario-btn").disabled = true;
    document.getElementById("delete-scenario-btn").disabled = true;
    document.getElementById("scenario-title").value = "";
    scenarioTextArea.value = "";
    starterConversation = [];
    renderStarterList();
    await loadAllScenarios();
    await loadScenarioList();
  } catch (err) {
    console.error("❌ 삭제 실패:", err);
    Swal.fire({
      icon: 'error',
      title: '삭제 실패',
      text: '❌ 삭제 실패. 콘솔을 확인하세요.'
    });
  }
});

//새 시나리오 입력
document.getElementById("new-scenario-btn").addEventListener("click", () => {
  // 입력창/변수/리스트 모두 초기화
  document.getElementById("scenario-title").value = "";
  document.getElementById("scenario-text").value = "";
  starterConversation = [];
  renderStarterList();

  selectedScenarioId = null;
  document.getElementById("update-scenario-btn").disabled = true;
  document.getElementById("delete-scenario-btn").disabled = true;
});

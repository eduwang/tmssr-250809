import { getFirestore, doc, getDoc, collection, getDocs, setDoc } from "firebase/firestore";
import { marked } from 'marked';
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { auth, db } from "./firebaseConfig.js";

const allowedAdmins = ["MhtH5gvH0RMv4yogqP4Tj6ki4Tp1"];

const userSelect = document.getElementById("user-select");
const activitySelect = document.getElementById("activity-select");
const scenarioSelect = document.getElementById("scenario-select");
const dateSelect = document.getElementById("date-select");
const resultsContainer = document.getElementById("results-container");

let allUsers = [];
let allScenarios = [];
let todayString = new Date().toISOString().split("T")[0];

// 🔐 인증 및 초기화
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, (user) => {
    if (user && allowedAdmins.includes(user.uid)) {
      initAdminPage();
      loadScenarioList(); // ✅ 시나리오 목록 불러오기 추가!
    } else {
      alert("접근 권한이 없습니다.");
      window.location.href = "/";
    }
  });
});

async function initAdminPage() {
  await loadAllUsers();
  await loadAllScenarios();
  await populateDate();
  userSelect.addEventListener("change", filterAndRender);
  activitySelect.addEventListener("change", filterAndRender);
  scenarioSelect.addEventListener("change", filterAndRender);
  dateSelect.addEventListener("change", async () => {
    await loadAllUsers();         // 🔄 날짜 바뀌면 사용자 목록 갱신
    filterAndRender();            // 🔄 결과도 재렌더링
  });
  filterAndRender();
}

async function loadAllUsers() {
  const selectedDate = dateSelect.value; // 🔹 선택된 날짜 문자열 (예: '2025-07-28')
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

  // 🔄 드롭다운 초기화 후 옵션 다시 채우기
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


async function loadAllScenarios() {
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

function populateDate() {
  dateSelect.value = todayString;
}

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
    
    // ✅ 사용자 입력은 강조 (isUser === true)
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

// ✅ 시나리오 작성 기능 연결
const scenarioTextArea = document.getElementById("scenario-text");
const starterSpeaker = document.getElementById("starter-speaker");
const starterMessage = document.getElementById("starter-message");
const addStarterBtn = document.getElementById("add-starter-btn");
const starterList = document.getElementById("starter-conversation-list");
const saveScenarioBtn = document.getElementById("save-scenario-btn");

let starterConversation = [];

// 초기 대화 추가
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

function renderStarterList() {
  starterList.innerHTML = "";
  starterConversation.forEach((entry, idx) => {
    const p = document.createElement("p");
    p.innerHTML = `<strong>${entry.speaker}:</strong> ${entry.message} 
     <button onclick="removeStarter(${idx})" class="btn btn-delete" style="margin-left:10px;">❌</button>`;
    starterList.appendChild(p);
  });
}

window.removeStarter = function(idx) {
  starterConversation.splice(idx, 1);
  renderStarterList();
};

// 저장 버튼 누르면 Firestore에 저장
saveScenarioBtn.addEventListener("click", async () => {
  const title = document.getElementById("scenario-title").value.trim();
  const text = scenarioTextArea.value.trim();

  if (!title || !text) {
    alert("제목과 시나리오 내용을 모두 입력하세요.");
    return;
  }

  const docId = `scenario_${Date.now()}`;  // 고유 ID 생성

  try {
    await setDoc(doc(db, "lessonPlayScenarios", docId), {
      title,
      scenarioText: text,
      starterConversation
    });

    alert("✅ 시나리오 저장 완료!");
    loadScenarioList(); // 저장 후 목록 갱신
  } catch (err) {
    console.error("시나리오 저장 실패:", err);
    alert("❌ 저장 실패. 콘솔을 확인하세요.");
  }
});

//시나리오 저장 함수
async function loadScenarioList() {
  const listContainer = document.getElementById("scenario-list");
  listContainer.innerHTML = "";

  const snapshot = await getDocs(collection(db, "lessonPlayScenarios"));
  snapshot.forEach(docSnap => {
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

      
      // ✅ Firestore에 선택된 시나리오 ID 저장
      try {
        await setDoc(doc(db, "lessonPlayScenarios", "config"), {
          selectedScenarioId: docSnap.id
        }, { merge: true });
        console.log("✅ 선택된 시나리오 ID 저장:", docSnap.id);
      } catch (err) {
        console.error("❌ 선택 ID 저장 실패:", err);
      }
      
    };
    listContainer.appendChild(button);
  });
}

// 🔁 시나리오 설정 열기/닫기
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


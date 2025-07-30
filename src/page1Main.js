import { auth } from "./firebaseConfig";
import { signOut } from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  serverTimestamp,
  collection
} from "firebase/firestore";
import { db } from "./firebaseConfig.js";
import { observeAuthState } from "./authHelpers";
import Swal from "sweetalert2";

// 🔸 전역 상태 변수
let currentUser = null;
let baseConversation = [];
let userConversation = [];
let selectedScenarioId = null;

// ✅ 페이지 로드 완료 시
document.addEventListener("DOMContentLoaded", () => {
  const speakerInput = document.getElementById("speaker-input");
  const messageInput = document.getElementById("message-input");
  const addMessageBtn = document.getElementById("add-message-btn");
  const undoBtn = document.getElementById("undo-btn");

  // 🔐 로그인 상태 확인
  observeAuthState(
    async (user) => {
      currentUser = user;
      document.getElementById("user-name").textContent = `${user.displayName}님`;
      await loadScenario();
      await loadUserSavedResults();
    },
    () => {
      Swal.fire({
        icon: "warning",
        title: "로그인이 필요합니다",
        text: "메인 페이지로 이동합니다.",
        confirmButtonText: "확인",
      }).then(() => {
        window.location.href = "/index.html";
      });
    }
  );

  // 로그아웃
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(auth);
  });

  // 엔터키 입력
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMessageBtn.click();
    }
  });

  // ➕ 대화 입력
  addMessageBtn.addEventListener("click", () => {
    const speaker = speakerInput.value.trim();
    const message = messageInput.value.trim();
    if (!speaker || !message) return;

    const chatEntry = { speaker, message };
    userConversation.push(chatEntry);
    appendToConversationLog(chatEntry, true);

    speakerInput.value = "";
    messageInput.value = "";
    speakerInput.focus();
  });

  // ↩️ 되돌리기
  undoBtn.addEventListener("click", () => {
    if (userConversation.length > 0) {
      userConversation.pop();
      renderConversationLog();
    }
  });

  // "활동 완료하기" 클릭
  document.getElementById("submit-btn").addEventListener("click", async () => {
    if (!currentUser || userConversation.length === 0) return;

    const timestamp = new Date();
    const docId = `${currentUser.uid}_page1_${timestamp.getTime()}`;

    if (!selectedScenarioId) {
      Swal.fire("❌ 시나리오 없음", "저장할 시나리오가 선택되지 않았습니다.", "error");
      return;
    }

    try {
      await setDoc(doc(db, "lessonPlayResponses", docId), {
        uid: currentUser.uid,
        displayName: currentUser.displayName,
        email: currentUser.email,
        createdAt: serverTimestamp(),
        scenarioId: selectedScenarioId,
        conversation: [
          ...baseConversation.map(e => ({ ...e, isUser: false })),
          ...userConversation.map(e => ({ ...e, isUser: true }))
        ]
      });

      Swal.fire("✅ 저장 완료", "대화가 저장되었습니다.", "success");

      // 화면에 결과 추가
      renderSavedResult({
        id: docId,
        createdAt: timestamp,
        conversation: [...baseConversation, ...userConversation]
      });

      userConversation = [];
      renderConversationLog();
    } catch (err) {
      console.error("저장 실패:", err);
      Swal.fire("❌ 저장 실패", "다시 시도해주세요.", "error");
    }
  });
});

// ✅ 시나리오 + 초기 대화 불러오기
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
        appendToConversationLog(entry);
      });
    }
  } catch (error) {
    console.error("시나리오 로딩 실패:", error);
    Swal.fire("시나리오 로딩 실패", error.message, "error");
  }
}

// ✅ 입력된 대화 1줄을 화면에 추가
function appendToConversationLog({ speaker, message }, isUser = false) {
  const log = document.getElementById("conversation-log");
  const entry = document.createElement("p");
  entry.innerHTML = `<strong>${speaker}:</strong> ${message}`;
  if (isUser) entry.classList.add("user-entry");
  log.appendChild(entry);
}

// ✅ 전체 대화 로그 다시 그리기 (되돌리기 포함)
function renderConversationLog() {
  const log = document.getElementById("conversation-log");
  log.innerHTML = "";
  baseConversation.forEach((entry) => appendToConversationLog(entry, false));
  userConversation.forEach((entry) => appendToConversationLog(entry, true));
}

// ✅ 현재 시나리오에 대한 "page1" 결과만 불러오기
async function loadUserSavedResults() {
  const snapshot = await getDocs(collection(db, "lessonPlayResponses"));

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const isPage1 = docSnap.id.includes("page1");
    if (
      data.uid === currentUser.uid &&
      data.scenarioId === selectedScenarioId &&
      data.conversation &&
      isPage1
    ) {
      const createdAt = data.createdAt?.toDate?.() || new Date();
      renderSavedResult({
        id: docSnap.id,
        createdAt,
        conversation: data.conversation
      });
    }
  });
}

// ✅ 저장된 결과 1건을 카드로 표시 + SweetAlert2 삭제 알림
function renderSavedResult({ id, createdAt, conversation }) {
  const container = document.getElementById("saved-results-container");

  const box = document.createElement("div");
  box.classList.add("saved-result");
  box.setAttribute("data-id", id);

  const header = document.createElement("div");
  header.classList.add("saved-header");
  header.textContent = `📅 ${createdAt.toLocaleString('ko-KR')} 제출됨`;

  const delBtn = document.createElement("button");
  delBtn.classList.add("delete-btn");
  delBtn.textContent = "삭제";
  delBtn.style.display = "none";
  delBtn.onclick = () => deleteSavedResult(id, box);
  header.appendChild(delBtn);

  box.appendChild(header);

  conversation.forEach(entry => {
    const p = document.createElement("p");
    p.innerHTML = `<strong>${entry.speaker}:</strong> ${entry.message}`;
    if (entry.isUser) p.classList.add("user-entry");
    box.appendChild(p);
  });

  container.prepend(box); // 최신이 위로
}

// ✅ SweetAlert2 삭제 알림
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

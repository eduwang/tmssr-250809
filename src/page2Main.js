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

let currentUser = null;
let baseConversation = [];
let userConversation = [];
let selectedScenarioId = null;

document.addEventListener("DOMContentLoaded", () => {
  const speakerInput = document.getElementById("speaker-input");
  const messageInput = document.getElementById("message-input");
  const addMessageBtn = document.getElementById("add-message-btn");
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

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addMessageBtn.click();
    }
  });

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

  undoBtn.addEventListener("click", () => {
    if (userConversation.length > 0) {
      userConversation.pop();
      renderConversationLog();
    }
  });

  feedbackBtn.addEventListener("click", async () => {
    const allConv = [
      ...baseConversation.map(e => ({ ...e, isUser: false })),
      ...userConversation.map(e => ({ ...e, isUser: true }))
    ];
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
        const docId = `${currentUser.uid}_page2_${timestamp.getTime()}`;
        await setDoc(doc(db, "lessonPlayResponses", docId), {
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          email: currentUser.email,
          scenarioId: selectedScenarioId,
          updatedAt: serverTimestamp(),
          conversation: allConv,
          feedback: feedback
        });

        Swal.fire({
          icon: "success",
          title: "피드백 저장 완료",
          text: "대화와 GPT 피드백이 저장되었습니다!"
        });

        // 새 카드 위에 추가
        renderSavedResult({
          id: docId,
          createdAt: timestamp,
          conversation: allConv,
          feedback
        });

        userConversation = [];
        renderConversationLog();
      }
    } catch (err) {
      console.error("피드백 오류:", err);
      document.getElementById("result").textContent = "⚠️ 피드백 생성에 실패했습니다.";
      Swal.fire({
        icon: "error",
        title: "저장 실패",
        text: "GPT 피드백을 생성하거나 저장하는 데 실패했습니다."
      });
    }
    feedbackBtn.disabled = false;
  });
});

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
    const log = document.getElementById("conversation-log");
    log.innerHTML = "";
    if (Array.isArray(scenarioData.starterConversation)) {
      scenarioData.starterConversation.forEach(entry => {
        baseConversation.push(entry);
        appendToConversationLog(entry, false);
      });
    }
  } catch (error) {
    console.error("시나리오 로딩 실패:", error);
    Swal.fire("시나리오 로딩 실패", error.message, "error");
  }
}

function appendToConversationLog({ speaker, message }, isUser = false) {
  const log = document.getElementById("conversation-log");
  const entry = document.createElement("p");
  entry.innerHTML = `<strong>${speaker}:</strong> ${message}`;
  if (isUser) entry.classList.add("user-entry");
  log.appendChild(entry);
}

function renderConversationLog() {
  const log = document.getElementById("conversation-log");
  log.innerHTML = "";
  baseConversation.forEach((entry) => appendToConversationLog(entry, false));
  userConversation.forEach((entry) => appendToConversationLog(entry, true));
}

// 🔵 Firestore에서 내 저장 결과 모두 불러와 누적 카드로 보여주기
async function loadUserSavedResults() {
  const snapshot = await getDocs(collection(db, "lessonPlayResponses"));
  const container = document.getElementById("saved-results-container");
  container.innerHTML = "";

  // 최신순 내림차순
  const myResults = [];
  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (
      data.uid === currentUser.uid &&
      data.scenarioId === selectedScenarioId &&
      data.conversation &&
      data.feedback
    ) {
      const createdAt = data.createdAt?.toDate?.() || data.updatedAt?.toDate?.() || new Date();
      myResults.push({
        id: docSnap.id,
        createdAt,
        conversation: data.conversation,
        feedback: data.feedback
      });
    }
  });
  myResults.sort((a, b) => b.createdAt - a.createdAt);
  myResults.forEach(renderSavedResult);
}

// 🔵 카드로 저장 결과 출력
function renderSavedResult({ id, createdAt, conversation, feedback }) {
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
  delBtn.onclick = () => deleteSavedResult(id, box);
  delBtn.style.display = "none"
  header.appendChild(delBtn);
  box.appendChild(header);

  conversation.forEach(entry => {
    const p = document.createElement("p");
    p.innerHTML = `<strong>${entry.speaker}:</strong> ${entry.message}`;
    if (entry.isUser) p.classList.add("user-entry");
    box.appendChild(p);
  });

  const feedbackBox = document.createElement("div");
  feedbackBox.classList.add("feedback-area");
  feedbackBox.innerHTML = marked.parse(feedback || "(피드백 없음)");
  box.appendChild(feedbackBox);

  // 최신순으로 위에 쌓이게
  container.prepend(box);
}

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

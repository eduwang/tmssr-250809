import { auth } from "./firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";

// 유저 상태 감지 후 콜백 실행
export function observeAuthState(onUserFound, onNoUser) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      onUserFound(user);
    } else {
      onNoUser();
    }
  });
}

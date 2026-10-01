import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initDarkMode } from "./lib/darkMode";
import "./styles.css";
import "./commercial.css";
import "./components/floating-ai-tutor.css";
import "./student/ai-tutor-archive.css";
import "./pages/ai-learning.css";
import "./pages/account.css";
initDarkMode(); // Áp dụng theme trước render để tránh FOWT
const root = document.getElementById("root")!;
const app = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
if (root.querySelector("main")) hydrateRoot(root, app);
else createRoot(root).render(app);

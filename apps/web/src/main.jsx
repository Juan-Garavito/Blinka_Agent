import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createRouter } from "./app/router.jsx";
import { ToastProvider } from "./components/ui.jsx";
import { SessionProvider } from "./lib/session.jsx";
import "./styles/base.css";
import "./styles/ledger.css";

const router = createRouter();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SessionProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </SessionProvider>
  </StrictMode>,
);

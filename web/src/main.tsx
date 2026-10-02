import { initializeNotificationNavigation } from "./lib/notificationNavigation";
import { initializeNotifications } from "./lib/pushNotifications";
import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

initializeNotificationNavigation();
void initializeNotifications();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

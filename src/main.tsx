import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource-variable/urbanist";
import "@fontsource-variable/plus-jakarta-sans";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

const router = getRouter();
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);

import React from "react";
import { createBrowserRouter } from "react-router-dom";
import App from "./App";
import Home from "./pages/Home";
import Market from "./pages/Market";
import IDLExplorer from "./dev/IDLExplorer";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "market/:pk", element: <Market /> },
      { path: "dev/idl", element: <IDLExplorer /> },
    ],
  },
]);

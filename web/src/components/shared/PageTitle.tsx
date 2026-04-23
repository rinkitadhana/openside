"use client";

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

interface PageTitleProps {
  title: string;
  description?: string;
}

export default function PageTitle({ title, description }: PageTitleProps) {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = title;

    if (description) {
      const metaDescription = document.querySelector(
        'meta[name="description"]',
      );
      if (metaDescription) {
        metaDescription.setAttribute("content", description);
      } else {
        const meta = document.createElement("meta");
        meta.name = "description";
        meta.content = description;
        document.head.appendChild(meta);
      }
    }
  }, [title, description, pathname]);

  return null;
}

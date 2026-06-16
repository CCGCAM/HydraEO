"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-site-nav]");
  const links = nav ? Array.from(nav.querySelectorAll("a[href^='#']")) : [];

  const closeNavigation = () => {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", "false");
    nav.classList.remove("open");
  };

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("open", !open);
    });
    links.forEach((link) => link.addEventListener("click", closeNavigation));
  }

  if ("IntersectionObserver" in window) {
    const sections = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
        links.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
      });
    }, { rootMargin: "-25% 0px -65%", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
  }

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.copyTarget || "");
      if (!target || !navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        button.textContent = "Copied";
        window.setTimeout(() => { button.textContent = "Copy commands"; }, 1600);
      } catch {
        button.textContent = "Copy unavailable";
      }
    });
  });
});

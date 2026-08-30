/* FORMFIT AUTH / ACCOUNT V3
   Account UI only.
   Does NOT touch camera, pose, pipes, exercises, scoring or history logic.
*/
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  async function getSession() {
    try {
      const response = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      });

      if (!response.ok) return { authenticated: false };
      return await response.json();
    } catch (_) {
      return { authenticated: false };
    }
  }

  function openLogin() {
    const overlay = $("authOverlay");
    if (!overlay) return;

    overlay.classList.add("visible");
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");

    setTimeout(() => $("authEmail")?.focus(), 80);
  }

  function closeAccountSheet() {
    const sheet = $("accountSheetOverlay");
    if (!sheet) return;

    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("account-sheet-open");
  }

  function openAccountSheet() {
    const sheet = $("accountSheetOverlay");

    // The current FormFit UI already contains the professional
    // account sheet. Reuse it instead of creating another UI.
    if (sheet) {
      window.dispatchEvent(new CustomEvent("formfit:open-account"));
      return true;
    }

    // Safe fallback if the sheet is not present.
    const email = $("accountEmail")?.textContent?.trim() || "Account";
    const avatar = $("accountAvatar")?.textContent?.trim() || "U";

    if (window.confirm(`Account\n\n${email}\n\nOK = Sign out\nCancel = stay signed in`)) {
      signOut();
    }

    return true;
  }

  async function handleAccountClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const session = await getSession();

    if (session?.authenticated) {
      openAccountSheet();
    } else {
      openLogin();
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store"
      });
    } catch (_) {}

    try {
      if (typeof window.stopFormSession === "function") {
        window.stopFormSession();
      }
    } catch (_) {}

    const email = $("accountEmail");
    const avatar = $("accountAvatar");

    if (email) email.textContent = "Not signed in";
    if (avatar) avatar.textContent = "U";

    closeAccountSheet();
    openLogin();
  }

  function bind() {
    const accountButton = $("accountBtn");

    if (accountButton && accountButton.dataset.formfitAccountBound !== "1") {
      accountButton.dataset.formfitAccountBound = "1";
      accountButton.addEventListener("click", handleAccountClick);
    }

    const signOutButton = $("accountSignoutBtn");
    if (signOutButton && signOutButton.dataset.formfitSignoutBound !== "1") {
      signOutButton.dataset.formfitSignoutBound = "1";
      signOutButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await signOut();
      });
    }

    const switchButton = $("accountSwitchBtn");
    if (switchButton && switchButton.dataset.formfitSwitchBound !== "1") {
      switchButton.dataset.formfitSwitchBound = "1";
      switchButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store"
          });
        } catch (_) {}

        const email = $("accountEmail");
        const avatar = $("accountAvatar");

        if (email) email.textContent = "Not signed in";
        if (avatar) avatar.textContent = "U";

        closeAccountSheet();
        openLogin();
      });
    }
  }

  // Bind after the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }

  // Also expose a tiny safe hook for the existing FormFit UI.
  window.formfitOpenAccount = openAccountSheet;
  window.formfitSignOut = signOut;
})();

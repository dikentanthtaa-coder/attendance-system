"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, EllipsisVertical, Share, SquarePlus, WifiOff } from "lucide-react";
import { Button, type ButtonVariant } from "./button";
import { Modal, ModalActions } from "./modal";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

// The browser offers this once, possibly before anything has rendered, so it's kept outside any screen.
let installEvent: InstallEvent | null = null;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  // An offer that arrived before this code did, caught by the script in the root layout.
  installEvent = (window as { __installEvent?: InstallEvent | null }).__installEvent ?? null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event as InstallEvent;
    notifyInstall();
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    notifyInstall();
  });
}

function installSnapshot(): "prompt" | "ios" | null {
  if (installEvent) return "prompt";
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
  if (standalone) return null;
  // iPhones have no install prompt: people add the app from Safari's Share menu.
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : null;
}

const subscribeInstall = (listener: () => void) => {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
};

/** Shows only where the app can actually be installed, and never once it's running as an app. */
export function InstallButton({
  variant = "ghost",
  className = "",
  alwaysLabelled = false,
}: {
  variant?: ButtonVariant;
  className?: string;
  /** In the menu drawer there's room for the words on every screen. */
  alwaysLabelled?: boolean;
}) {
  const mode = useSyncExternalStore(subscribeInstall, installSnapshot, () => null);
  const [help, setHelp] = useState<"ios" | "menu" | null>(null);
  // The help stays open even after the button has hidden itself.
  if (!mode && !help) return null;

  async function install() {
    if (mode === "ios") return setHelp("ios");
    // An offer works once only. It's taken before prompting, so a second tap can't reuse a spent one,
    // and the button hides until Chrome makes a new offer, which it does if this one is dismissed.
    const offer = installEvent;
    installEvent = null;
    notifyInstall();
    try {
      if (!offer) throw new Error("no install offer");
      await offer.prompt();
      await offer.userChoice;
    } catch {
      // Chrome turned the prompt down, so explain the browser's own way to install instead.
      setHelp("menu");
    }
  }

  return (
    <>
      {mode && (
        <Button variant={variant} icon={Download} aria-label="Install app" className={className} onClick={install}>
          <span className={alwaysLabelled ? "" : "hidden sm:inline"}>Install app</span>
        </Button>
      )}
      <InstallHelp help={help} onClose={() => setHelp(null)} />
    </>
  );
}

function InstallHelp({ help, onClose }: { help: "ios" | "menu" | null; onClose: () => void }) {
  return (
    <Modal open={help !== null} onClose={onClose} title={help === "ios" ? "Install on iPhone or iPad" : "Install from the browser menu"}>
      <ol className="flex flex-col gap-3">
        {help === "ios" ? (
          <>
            <li className="flex items-center gap-2"><Share aria-hidden size={18} className="shrink-0 text-brand" />In Safari, tap the Share button.</li>
            <li className="flex items-center gap-2"><SquarePlus aria-hidden size={18} className="shrink-0 text-brand" />Tap Add to Home Screen, then Add.</li>
          </>
        ) : (
          <>
            <li className="flex items-center gap-2"><EllipsisVertical aria-hidden size={18} className="shrink-0 text-brand" />Open the browser menu (⋮).</li>
            <li className="flex items-center gap-2"><Download aria-hidden size={18} className="shrink-0 text-brand" />Tap Install app or Add to Home screen.</li>
          </>
        )}
      </ol>
      <ModalActions>
        <Button onClick={onClose}>Done</Button>
      </ModalActions>
    </Modal>
  );
}

/** Registers the service worker. Not in development, where it would serve code that's being edited. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {}); // the app works the same without it
    }
  }, []);
  return null;
}

const subscribeOnline = (listener: () => void) => {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

/** A person at a desk needs to know at once when a tap can't be saved. */
export function OfflineNotice() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-40 flex items-center justify-center gap-2 bg-warn px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 text-sm font-semibold text-white">
      <WifiOff aria-hidden size={16} className="shrink-0" />
      No internet. Marks can&apos;t be saved until you&apos;re back online.
    </div>
  );
}

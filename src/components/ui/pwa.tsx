"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share, SquarePlus, WifiOff } from "lucide-react";
import { Button, type ButtonVariant } from "./button";
import { Modal, ModalActions } from "./modal";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

// The browser offers this once, possibly before anything has rendered, so it's kept outside any screen.
let installEvent: InstallEvent | null = null;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
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
export function InstallButton({ variant = "ghost", className = "" }: { variant?: ButtonVariant; className?: string }) {
  const mode = useSyncExternalStore(subscribeInstall, installSnapshot, () => null);
  const [showHelp, setShowHelp] = useState(false);
  if (!mode) return null;

  async function install() {
    if (mode === "ios") return setShowHelp(true);
    await installEvent?.prompt();
    await installEvent?.userChoice;
    installEvent = null;
    notifyInstall();
  }

  return (
    <>
      <Button variant={variant} icon={Download} aria-label="Install app" className={className} onClick={install}>
        <span className="hidden sm:inline">Install app</span>
      </Button>
      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Install on iPhone or iPad">
        <ol className="flex flex-col gap-3">
          <li className="flex items-center gap-2"><Share aria-hidden size={18} className="shrink-0 text-brand" />In Safari, tap the Share button.</li>
          <li className="flex items-center gap-2"><SquarePlus aria-hidden size={18} className="shrink-0 text-brand" />Tap Add to Home Screen, then Add.</li>
        </ol>
        <ModalActions>
          <Button onClick={() => setShowHelp(false)}>Done</Button>
        </ModalActions>
      </Modal>
    </>
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

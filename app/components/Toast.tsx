'use client';

import { useState, useCallback, useEffect } from 'react';

interface ToastMessage {
  icon: string;
  text: string;
  id: number;
}

let toastCounter = 0;
const listeners: ((msg: ToastMessage) => void)[] = [];

export function showToast(icon: string, text: string) {
  const msg: ToastMessage = { icon, text, id: ++toastCounter };
  listeners.forEach(fn => fn(msg));
}

export default function Toast() {
  const [msg, setMsg] = useState<ToastMessage | null>(null);
  const [visible, setVisible] = useState(false);

  const handleMessage = useCallback((m: ToastMessage) => {
    setMsg(m);
    setVisible(true);
    setTimeout(() => setVisible(false), 3500);
  }, []);

  useEffect(() => {
    listeners.push(handleMessage);
    return () => {
      const idx = listeners.indexOf(handleMessage);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, [handleMessage]);

  return (
    <div
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-6 py-3 rounded-full bg-[rgba(5,5,5,0.92)] backdrop-blur-[20px] border border-white/[0.12] text-sm font-medium z-[2000] transition-all duration-400 ${
        visible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-5 pointer-events-none'
      }`}
      role="alert"
      aria-live="assertive"
    >
      <span aria-hidden="true">{msg?.icon}</span>
      <span>{msg?.text}</span>
    </div>
  );
}

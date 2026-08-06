"use client";

import { type ChangeEvent, useRef, useState } from "react";

import {
  exportSettingsBackup,
  importSettingsBackup,
} from "@/lib/settingsBackup";
import type { ClientState } from "@/lib/storage";

type SettingsTransferProps = {
  value: ClientState;
  onImport: (state: ClientState) => void;
};

export function SettingsTransfer({ value, onImport }: SettingsTransferProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function exportBackup() {
    try {
      const backup = exportSettingsBackup(value);
      const blob = new Blob([backup.json], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = backup.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setError("");
      setStatus(`${backup.filename} 파일을 만들었습니다.`);
    } catch (reason: unknown) {
      setStatus("");
      setError(
        reason instanceof Error
          ? reason.message
          : "설정 파일을 만들지 못했습니다.",
      );
    }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 1_000_000) {
      setStatus("");
      setError("설정 파일은 1MB 이하여야 합니다.");
      return;
    }
    try {
      const imported = importSettingsBackup(await file.text());
      onImport(imported);
      setError("");
      setStatus(
        `${file.name}의 설정을 불러왔습니다. 아래의 ‘저장하고 새로고침’을 눌러 확정하세요.`,
      );
    } catch (reason: unknown) {
      setStatus("");
      setError(
        reason instanceof Error
          ? reason.message
          : "설정 파일을 읽지 못했습니다.",
      );
    }
  }

  return (
    <section>
      <h3 className="text-lg font-black">설정 백업 및 옮기기</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        다른 브라우저나 기기로 집·회사, 시간, 공급자와 API 설정을 한 번에 옮길
        수 있습니다.
      </p>
      <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs leading-5 text-rose-950">
        <strong>보안 주의:</strong> 내보낸 JSON은 암호화되지 않으며
        카카오·기상청·Windy 키와 프록시 URL, 집·회사 좌표를 그대로 포함합니다.
        공개 저장소·메신저·공용 PC에 올리지 말고 개인 보관용으로만 사용하세요.
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="secondary-button"
          onClick={exportBackup}
          type="button"
        >
          설정 내보내기
        </button>
        <button
          className="secondary-button"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          설정 가져오기
        </button>
        <input
          accept="application/json,.json"
          hidden
          onChange={(event) => void importBackup(event)}
          ref={fileInputRef}
          type="file"
        />
      </div>
      {status && (
        <p className="mt-2 text-xs leading-5 text-emerald-800" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs leading-5 text-rose-800" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

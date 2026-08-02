"use client";
/* eslint-disable @next/next/no-img-element */
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

const maxImages = 5;

export function ImageAttachments({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  async function add(files: FileList | null) {
    if (!files) return;
    setError("");
    try {
      const room = Math.max(0, maxImages - values.length);
      const images = [...files].filter((file) => file.type.startsWith("image/")).slice(0, room);
      const encoded = await Promise.all(images.map(resizeImage));
      onChange([...values, ...encoded]);
      if (files.length > room) setError(`이미지는 최대 ${maxImages}장까지 첨부할 수 있습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이미지를 읽지 못했습니다.");
    } finally {
      if (input.current) input.current.value = "";
    }
  }
  return <div><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{values.map((source, index) => <div key={`${source.slice(-24)}-${index}`} className="group relative aspect-video overflow-hidden rounded-lg border bg-[var(--surface-muted)]"><img src={source} alt={`첨부 이미지 ${index + 1}`} className="size-full object-cover" /><button type="button" aria-label={`첨부 이미지 ${index + 1} 삭제`} onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/65 text-white"><Trash2 size={14} /></button></div>)}</div><input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(event) => void add(event.target.files)} /><button type="button" disabled={values.length >= maxImages} onClick={() => input.current?.click()} className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><ImagePlus size={16} />이미지 추가 <span className="text-xs text-[var(--muted)]">({values.length}/{maxImages})</span></button>{error && <p className="mt-2 text-xs text-red-600">{error}</p>}<p className="mt-2 text-xs text-[var(--muted)]">오프라인 사용을 위해 앱 데이터에 저장하며, 백업 파일에도 포함됩니다.</p></div>;
}

function resizeImage(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error("15MB 이하 이미지만 첨부할 수 있습니다."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("지원하지 않는 이미지 형식입니다."));
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

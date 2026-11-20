import { useEffect, useState } from 'react';
import { Box, FileCode2, Palette } from 'lucide-react';

interface ItemImageProps {
  typeId: number;
  name: string;
  size?: 32 | 64;
  className?: string;
}

export function ItemImage({ typeId, name, size = 32, className = '' }: ItemImageProps) {
  const isBlueprint = name.endsWith('Blueprint');
  const isSkin = name.endsWith('SKIN');

  const variants = isBlueprint
    ? ['bp', 'icon']
    : ['icon', 'render', 'bp'];

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setAttempt(0);
  }, [typeId]);

  if (attempt >= variants.length) {
    return (
      <div
        className={`flex items-center justify-center rounded bg-slate-900 border border-slate-800 text-slate-500 shrink-0 ${className}`}
        title={name}
      >
        {isSkin ? (
          <Palette className="w-4 h-4 text-cyan-400/70" />
        ) : isBlueprint ? (
          <FileCode2 className="w-4 h-4 text-sky-400/70" />
        ) : (
          <Box className="w-4 h-4 text-slate-500" />
        )}
      </div>
    );
  }

  const variant = variants[attempt];
  const src = `https://images.evetech.net/types/${typeId}/${variant}?size=${size}`;

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setAttempt((prev) => prev + 1)}
      className={`rounded bg-slate-900 border border-slate-800 object-contain shrink-0 ${className}`}
    />
  );
}

import { memo } from 'react';
import NP1Preview from './phone-layouts/Phone1';
import NP1ExperimentalPreview from './phone-layouts/Phone1Experimental';
import NP2Preview from './phone-layouts/Phone2';
import NP2aPreview from './phone-layouts/Phone2a';
import NP3aPreview from './phone-layouts/Phone3a';
import { PhoneBack } from './phone-layouts/PhoneBack';
import { glyphGroupForZone } from './devices';

type PhonePreviewProps = {
  model: string;
  deviceMode: 'Grouped' | 'Individual';
  activeLevels: Float32Array;
  globalBrightness: number;
  mirrored: boolean;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const offColor = '#22282b';

function Phone3Matrix({ activeLevels, deviceMode, globalBrightness, mirrored }: PhonePreviewProps) {
  const brightnessAt = (index: number) => clamp((deviceMode === 'Grouped' ? activeLevels[5] ?? 0 : activeLevels[index] ?? 0) / 100 * globalBrightness);
  return <svg className={`phonePreview ${mirrored ? 'phonePreview--mirrored' : ''}`} viewBox="0 0 480 974" role="img" aria-label="Nothing Phone (3) Glyph Matrix preview">
    <defs><filter id="matrixGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <PhoneBack model="NP3"/>
    <g aria-label="Circular Glyph Matrix">
      {Array.from({ length: 625 }, (_, index) => {
        const row = Math.floor(index / 25), col = index % 25;
        const dx = col - 12, dy = row - 12;
        if (dx * dx + dy * dy > 156) return null;
        const intensity = brightnessAt(index), x = 388 + (col - 12) * 4, y = 143 + (row - 12) * 4;
        return <g key={index}>
          <circle cx={x} cy={y} r="1.55" fill={intensity ? '#fff' : '#252b2e'} opacity={intensity || .92}/>
          {intensity > 0 && <circle cx={x} cy={y} r="2.1" fill="#fff" opacity={intensity * .62} filter="url(#matrixGlow)"/>}
        </g>;
      })}
    </g>
  </svg>;
}

function PhonePreviewView({ model, deviceMode, activeLevels, globalBrightness, mirrored }: PhonePreviewProps) {
  const count = model === 'NP1' ? 5 : model === 'NP1_15' ? 15 : model === 'NP2' ? 33 : model === 'NP2a' || model === 'NP2aPlus' ? 26 : model === 'NP3a' ? 36 : 0;
  const zoneColors = Array.from({ length: count }, (_, index) => {
    const group = glyphGroupForZone(model, index);
    const level = deviceMode === 'Grouped' ? activeLevels[group] ?? 0 : activeLevels[index] ?? 0;
    const intensity = clamp(level / 100 * globalBrightness);
    return intensity === 0 ? offColor : `rgba(255,255,255,${Math.max(.16, intensity)})`;
  });
  const common = { zoneColors, mirrored };
  switch (model) {
    case 'NP1': return <NP1Preview {...common}/>;
    case 'NP1_15': return <NP1ExperimentalPreview {...common}/>;
    case 'NP2': return <NP2Preview {...common}/>;
    case 'NP2a':
    case 'NP2aPlus': return <NP2aPreview {...common}/>;
    case 'NP3a': return <NP3aPreview {...common}/>;
    case 'NP3': return <Phone3Matrix model={model} activeLevels={activeLevels} deviceMode={deviceMode} globalBrightness={globalBrightness} mirrored={mirrored}/>;
    default: return <NP2Preview {...common}/>;
  }
}

export const PhonePreview = memo(PhonePreviewView);

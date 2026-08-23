import React from 'react';
import { useEditor } from '../state/store';
import { Icon } from './ui';

export type PanelId = 'media' | 'record' | 'content' | 'templates' | 'transitions' | 'text' | 'captions' | 'brand';

const ITEMS: { id: PanelId; label: string; icon: React.ReactNode }[] = [
  { id: 'media', label: 'Your media', icon: Icon.media },
  { id: 'record', label: 'Record & create', icon: Icon.record },
  { id: 'content', label: 'Content library', icon: Icon.content },
  { id: 'templates', label: 'Templates', icon: Icon.templates },
  { id: 'transitions', label: 'Transitions', icon: Icon.transitions },
  { id: 'text', label: 'Text', icon: Icon.text },
  { id: 'captions', label: 'Captions', icon: Icon.captions },
  { id: 'brand', label: 'Brand kit', icon: Icon.brand },
];

export function Rail() {
  const panel = useEditor((s) => s.activePanel);
  const setPanel = useEditor((s) => s.setPanel);
  const panelOpen = useEditor((s) => s.panelOpen);
  const setPanelOpen = useEditor((s) => s.setPanelOpen);

  return (
    <nav className="rail" aria-label="Editor tools">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`rail-item${panel === item.id && panelOpen ? ' is-active' : ''}`}
          onClick={() => {
            if (panel === item.id) setPanelOpen(!panelOpen);
            else {
              setPanel(item.id);
              setPanelOpen(true);
            }
          }}
          title={item.label}
        >
          <span className="rail-icon">{item.icon}</span>
          <span className="rail-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export const RAIL_ITEMS = ITEMS;

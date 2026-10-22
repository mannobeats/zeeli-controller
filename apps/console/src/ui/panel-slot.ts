import { createContext } from 'react';

/** The section panel's content area, when the current section lets its page fill it. */
export const PanelSlot = createContext<HTMLElement | null>(null);

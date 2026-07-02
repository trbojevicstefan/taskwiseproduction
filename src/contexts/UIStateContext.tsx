// src/contexts/UIStateContext.tsx
"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export type UIScale = 'small' | 'medium' | 'large' | 'very-large';

interface UIStateContextType {
    uiScale: UIScale;
    setUiScale: (scale: UIScale) => void;
    showCopyHint: boolean;
    setShowCopyHint: (show: boolean) => void;
    showWeekends: boolean;
    setShowWeekends: (show: boolean) => void;
}

const UIStateContext = createContext<UIStateContextType | undefined>(undefined);

export const UIStateProvider = ({ children }: { children: ReactNode }) => {
    const [uiScale, setUiScale] = useState<UIScale>('medium');
    const [showCopyHint, setShowCopyHint] = useState(false);
    const [showWeekends, setShowWeekends] = useState(true);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        // Safely read from localStorage only after component has mounted.
        const storedScale = localStorage.getItem('uiScale');
        if (storedScale && ['small', 'medium', 'large', 'very-large'].includes(storedScale)) {
            setUiScale(storedScale as UIScale);
        }
        const storedShowWeekends = localStorage.getItem('showWeekends');
        if (storedShowWeekends) {
            setShowWeekends(JSON.parse(storedShowWeekends));
        }
    }, []);

    useEffect(() => {
        if (isMounted) {
            document.documentElement.setAttribute('data-ui-scale', uiScale);
            localStorage.setItem('uiScale', uiScale);
        }
    }, [uiScale, isMounted]);

    useEffect(() => {
        if (isMounted) {
            localStorage.setItem('showWeekends', JSON.stringify(showWeekends));
        }
    }, [showWeekends, isMounted]);

    const handleSetUiScale = useCallback((scale: UIScale) => {
        setUiScale(scale);
    }, []);

    if (!isMounted) {
        // To prevent hydration mismatch, we can return null or a loading state
        // until the component is mounted and has read from localStorage.
        return null;
    }

    const value = {
        uiScale,
        setUiScale: handleSetUiScale,
        showCopyHint,
        setShowCopyHint,
        showWeekends,
        setShowWeekends,
    };

    return (
        <UIStateContext.Provider value={value}>
            {children}
        </UIStateContext.Provider>
    );
};

export const useUIState = (): UIStateContextType => {
    const context = useContext(UIStateContext);
    if (context === undefined) {
        throw new Error('useUIState must be used within a UIStateProvider');
    }
    return context;
};

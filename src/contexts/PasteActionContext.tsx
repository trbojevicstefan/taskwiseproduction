
"use client";

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';

interface PasteActionContextType {
    isDialogOpen: boolean;
    pastedText: string | null;
    openPasteDialog: (text: string) => void;
    closePasteDialog: () => void;
}

const PasteActionContext = createContext<PasteActionContextType | undefined>(undefined);

export const PasteActionProvider = ({ children }: { children: ReactNode }) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [pastedText, setPastedText] = useState<string | null>(null);

    const openPasteDialog = useCallback((text: string) => {
        if (isDialogOpen) return; // Prevent opening if already open
        setPastedText(text);
        setIsDialogOpen(true);
    }, [isDialogOpen]);

    const closePasteDialog = useCallback(() => {
        setIsDialogOpen(false);
        // Delay clearing text to allow for exit animation
        setTimeout(() => setPastedText(null), 300);
    }, []);

    const value = {
        isDialogOpen,
        pastedText,
        openPasteDialog,
        closePasteDialog,
    };

    return (
        <PasteActionContext.Provider value={value}>
            {children}
        </PasteActionContext.Provider>
    );
};

export const usePasteAction = (): PasteActionContextType => {
    const context = useContext(PasteActionContext);
    if (context === undefined) {
        throw new Error('usePasteAction must be used within a PasteActionProvider');
    }
    return context;
};

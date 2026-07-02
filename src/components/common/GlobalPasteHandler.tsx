
"use client";

import React, { useEffect, useCallback } from 'react';
import { usePasteAction } from '@/contexts/PasteActionContext';
import PasteActionDialog from './PasteActionDialog';

const GlobalPasteHandler = () => {
    const { openPasteDialog, isDialogOpen, pastedText } = usePasteAction();

    const handlePaste = useCallback((event: ClipboardEvent) => {
        // Only trigger if a dialog/input isn't already the main focus
        const target = event.target as HTMLElement;
        const isWithinInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        
        if (isDialogOpen || isWithinInput) {
            return;
        }

        const pastedData = event.clipboardData?.getData('text/plain');
        if (pastedData && pastedData.trim().length > 0) {
            event.preventDefault();
            console.log("Global paste detected, opening dialog with text:", pastedData);
            openPasteDialog(pastedData);
        }
    }, [openPasteDialog, isDialogOpen]);

    useEffect(() => {
        document.addEventListener('paste', handlePaste);
        return () => {
            document.removeEventListener('paste', handlePaste);
        };
    }, [handlePaste]);
    
    // Only render the dialog if it's supposed to be open
    if (!isDialogOpen) return null;

    return <PasteActionDialog />;
};

export default GlobalPasteHandler;

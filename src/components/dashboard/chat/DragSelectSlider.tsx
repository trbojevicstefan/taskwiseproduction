// src/components/dashboard/chat/DragSelectSlider.tsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface DragSelectSliderProps {
    onSelectionChange: (selectedIds: Set<string>) => void;
    onDragStart: () => void;
    onDragEnd: (event: MouseEvent | TouchEvent) => void;
}

const SliderHandleIcon = () => (
    <svg width="24" height="48" viewBox="0 0 24 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="cursor-ns-resize drop-shadow-lg">
        <path d="M2 10C2 8.89543 2.89543 8 4 8H20C21.1046 8 22 8.89543 22 10V38C22 39.1046 21.1046 40 20 40H4C2.89543 40 2 39.1046 2 38V10Z" fill="hsl(var(--background))" />
        <path d="M1 12C1 10.3431 2.34315 9 4 9H20C21.6569 9 23 10.3431 23 12V20H1V12Z" fill="hsl(var(--muted))" />
        <rect x="4" y="23" width="16" height="2" rx="1" fill="hsl(var(--muted-foreground))" />
        <path d="M2 10C2 8.89543 2.89543 8 4 8H20C21.1046 8 22 8.89543 22 10V11H2V10Z" fill="white" fillOpacity="0.1" />
    </svg>
);


export const DragSelectSlider: React.FC<DragSelectSliderProps> = ({ onSelectionChange, onDragStart, onDragEnd }) => {
    const isDraggingRef = useRef(false);
    const sliderRef = useRef<HTMLDivElement>(null);
    const trailRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLDivElement>(null);
    const dragStartRef = useRef(0);
    const scrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    const stopScrolling = useCallback(() => {
        if (scrollIntervalRef.current) {
            clearInterval(scrollIntervalRef.current);
            scrollIntervalRef.current = null;
        }
    }, []);

    const updateSelection = useCallback(() => {
        const scrollContainer = document.getElementById('suggestion-scroll-area');
        if (!trailRef.current || !scrollContainer) return;
    
        const containerRect = scrollContainer.getBoundingClientRect();
        const trailRect = trailRef.current.getBoundingClientRect();
    
        // The trailRect's top/bottom are absolute viewport positions.
        // We need to compare them to the task elements' absolute viewport positions.
        const selectionTop = trailRect.top;
        const selectionBottom = trailRect.bottom;
    
        const newSelectedIds = new Set<string>();
    
        const taskElements = scrollContainer.querySelectorAll('[data-task-id]');
        taskElements.forEach(taskEl => {
            const taskRect = taskEl.getBoundingClientRect();
            // Check for vertical overlap between the trail and the task element
            if (taskRect.top < selectionBottom && taskRect.bottom > selectionTop) {
                const taskId = (taskEl as HTMLElement).getAttribute('data-task-id');
                if (taskId) {
                    newSelectedIds.add(taskId);
                }
            }
        });
        onSelectionChange(newSelectedIds);
    }, [onSelectionChange]);

    const handleMove = useCallback((clientY: number) => {
        if (!isDraggingRef.current || !sliderRef.current || !trailRef.current || !handleRef.current) return;

        const sliderRect = sliderRef.current.getBoundingClientRect();
        let newY = clientY - sliderRect.top;
        newY = Math.max(0, Math.min(newY, sliderRect.height));
        
        const trailTop = Math.min(dragStartRef.current, newY);
        const trailHeight = Math.abs(newY - dragStartRef.current);

        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

        animationFrameRef.current = requestAnimationFrame(() => {
            if (handleRef.current) {
                handleRef.current.style.transform = `translateY(${newY - 24}px)`;
            }
            if (trailRef.current) {
                trailRef.current.style.transform = `translateY(${trailTop}px)`;
                trailRef.current.style.height = `${trailHeight}px`;
            }
            
            // Auto-scroll logic
            const scrollArea = document.getElementById('suggestion-scroll-area');
            if (scrollArea) {
                const scrollContainer = scrollArea.querySelector('div:first-child') as HTMLElement;
                if (scrollContainer) {
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const scrollThreshold = 60;
                    stopScrolling();
                    if (clientY < containerRect.top + scrollThreshold) {
                        scrollIntervalRef.current = setInterval(() => { scrollContainer.scrollTop -= 20; updateSelection(); }, 20);
                    } else if (clientY > containerRect.bottom - scrollThreshold) {
                        scrollIntervalRef.current = setInterval(() => { scrollContainer.scrollTop += 20; updateSelection(); }, 20);
                    }
                }
            }
            updateSelection();
        });
    }, [stopScrolling, updateSelection]);

    const handleMouseUp = useCallback((e: MouseEvent) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        stopScrolling();
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        
        document.body.style.userSelect = '';
        if (trailRef.current) trailRef.current.style.display = 'none';

        onDragEnd(e);

        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    }, [onDragEnd, stopScrolling]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        handleMove(e.clientY);
    }, [handleMove]);

    const handleTouchUp = useCallback((e: TouchEvent) => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        stopScrolling();
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        
        document.body.style.userSelect = '';
        if (trailRef.current) trailRef.current.style.display = 'none';

        onDragEnd(e);

        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchUp);
    }, [onDragEnd, stopScrolling]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (e.touches[0]) handleMove(e.touches[0].clientY);
    }, [handleMove]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (!sliderRef.current) return;

        isDraggingRef.current = true;
        
        const startY = e.clientY - sliderRef.current.getBoundingClientRect().top;
        dragStartRef.current = startY;

        if (trailRef.current) trailRef.current.style.display = 'block';
        if (handleRef.current) handleRef.current.style.transform = `translateY(${startY - 24}px)`;
        document.body.style.userSelect = 'none';
        
        onDragStart();
        onSelectionChange(new Set());
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [onDragStart, onSelectionChange, handleMouseMove, handleMouseUp]);
    
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches[0] && sliderRef.current) {
            e.preventDefault();
            isDraggingRef.current = true;

            const startY = e.touches[0].clientY - sliderRef.current.getBoundingClientRect().top;
            dragStartRef.current = startY;

            if (trailRef.current) trailRef.current.style.display = 'block';
            if (handleRef.current) handleRef.current.style.transform = `translateY(${startY - 24}px)`;
            document.body.style.userSelect = 'none';

            onDragStart();
            onSelectionChange(new Set());
            window.addEventListener('touchmove', handleTouchMove);
            window.addEventListener('touchend', handleTouchUp);
        }
    }, [onDragStart, onSelectionChange, handleTouchMove, handleTouchUp]);

    return (
        <div 
            ref={sliderRef}
            className="w-8 flex-shrink-0 relative cursor-ns-resize"
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
        >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[2px] h-full bg-border/20 rounded-full" />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full flex flex-col justify-between py-6">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div key={i} className="w-full h-px bg-border/30" />
                ))}
            </div>
            
            <div 
                ref={trailRef}
                className="absolute left-1/2 -translate-x-1/2 w-2 rounded-full hidden"
                style={{ 
                    backgroundColor: 'hsl(var(--chart-2))',
                    boxShadow: '0 0 12px hsl(var(--chart-2)/0.7)'
                }}
            />
            
             <div 
                ref={handleRef}
                className="absolute left-0 top-0 h-12 w-6 flex items-center justify-center handle transition-opacity duration-200"
            >
                <SliderHandleIcon />
            </div>
        </div>
    );
};

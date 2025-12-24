// src/components/dashboard/chat/RadialMenu.tsx
import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, CalendarDays, Brain, X, Share2, GitCommitVertical } from 'lucide-react';

interface RadialMenuProps {
  state: { open: boolean; x: number; y: number };
  onClose: () => void;
  onAssign: () => void;
  onSetDueDate: () => void;
  onDelete: () => void;
  onShare: () => void;
  onBreakDown: () => void;
  onSimplify: () => void;
}

const AssignIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 21V19C16 16.7909 14.2091 15 12 15H5C2.79086 15 1 16.7909 1 19V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8.5 11C10.7091 11 12.5 9.20914 12.5 7C12.5 4.79086 10.7091 3 8.5 3C6.29086 3 4.5 4.79086 4.5 7C4.5 9.20914 6.29086 11 8.5 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M19 8V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 11H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const DueDateIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 2V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M16 2V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M3.5 9.09H20.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M21 8.5V17C21 20 19.5 22 16 22H8C4.5 22 3 20 3 17V8.5C3 5.5 4.5 3.5 8 3.5H16C19.5 3.5 21 5.5 21 8.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M15.6947 13.7H15.7037" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M15.6947 16.7H15.7037" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M11.9955 13.7H12.0045" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M11.9955 16.7H12.0045" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8.29431 13.7H8.30331" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8.29431 16.7H8.30331" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const ShareIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 12V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M16 6L12 2L8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 2V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const DeleteIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);


const menuItems = [
  { icon: AssignIcon, label: 'Assign', actionKey: 'onAssign', shortcut: '1' },
  { icon: DueDateIcon, label: 'Due Date', actionKey: 'onSetDueDate', shortcut: '2' },
  { icon: GitCommitVertical, label: 'Simplify', actionKey: 'onSimplify', shortcut: '3' },
  { icon: Brain, label: 'Break Down', actionKey: 'onBreakDown', shortcut: 'R' },
  { icon: ShareIcon, label: 'Share', actionKey: 'onShare', shortcut: 'S' },
  { icon: DeleteIcon, label: 'Delete', actionKey: 'onDelete', shortcut: '4', className: 'text-destructive' },
];

const RADIUS = 80;

export const RadialMenu: React.FC<RadialMenuProps> = ({ state, onClose, onAssign, onSetDueDate, onDelete, onShare, onBreakDown, onSimplify }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleAction = (actionKey: string) => {
    switch (actionKey) {
      case 'onAssign': onAssign(); break;
      case 'onSetDueDate': onSetDueDate(); break;
      case 'onDelete': onDelete(); break;
      case 'onShare': onShare(); break;
      case 'onBreakDown': onBreakDown(); break;
      case 'onSimplify': onSimplify(); break;
    }
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
        if (state.open) {
            const key = event.key.toUpperCase();
            const menuItem = menuItems.find(item => item.shortcut === key);
            if (menuItem) {
                event.preventDefault();
                handleAction(menuItem.actionKey);
            }
            if (event.key === 'Escape') {
              onClose();
            }
        }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state.open, onClose]);


  return (
    <AnimatePresence>
      {state.open && (
        <div
          ref={menuRef}
          className="fixed z-50 pointer-events-auto"
          style={{
            left: state.x,
            top: state.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30, duration: 0.1 }}
            className="relative w-40 h-40"
          >
            {menuItems.map((item, index) => {
              const angle = (index / menuItems.length) * 2 * Math.PI - (Math.PI / 2);
              const x = RADIUS * Math.cos(angle);
              const y = RADIUS * Math.sin(angle);
              return (
                <motion.button
                  key={item.label}
                  initial={{ x: 0, y: 0, scale: 0 }}
                  animate={{ x, y, scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25, delay: 0.02 * index }}
                  onClick={() => handleAction(item.actionKey)}
                  className={`absolute left-1/2 top-1/2 -ml-7 -mt-7 gem-icon-button w-14 h-14 bg-black/80 backdrop-blur-lg ${item.className || 'text-white'}`}
                  title={`${item.label} (${item.shortcut})`}
                >
                  <div className="relative w-full h-full flex items-center justify-center">
                    <item.icon />
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-xs font-mono text-foreground border">{item.shortcut}</span>
                  </div>
                </motion.button>
              );
            })}
            <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="absolute left-1/2 top-1/2 -ml-6 -mt-6 gem-icon-button w-12 h-12 bg-black/90"
              onClick={onClose}
              title="Close (Esc)"
            >
              <X className="h-6 w-6 text-white" />
            </motion.button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

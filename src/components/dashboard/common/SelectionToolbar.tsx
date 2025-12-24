// src/components/dashboard/common/SelectionToolbar.tsx
import React from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Copy, UserPlus, Trash2, X, Send, File, MessageCircle, Sheet, Bell, Slack, Ticket, CalendarDays, Brain, FileDown, Eye, Edit3 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { SiGoogletasks, SiTrello } from '@icons-pack/react-simple-icons';

const GoogleTasksIcon = () => (
    <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4">
        <path d="M12.3 8.245L7.01 2.955 4.058 5.908l5.29 5.29-2.008 2.008-5.29-5.29L.052 9.923l7.353 7.353.01.01.01-.01 2.95-2.95-2.007-2.007 5.93-5.93z" fill="#0095ff"/>
        <path d="M23.948 9.923l-1.998-1.997-5.29 5.29-2.008-2.008L21.005.858l-2.953-2.953-9.698 9.698 2.94 2.94 2.008-2.007 2.953 2.952.01-.01.01.01 7.353-7.353z" fill="#ffc900"/>
        <path d="M4.058 18.092l-2.005-2.005L14.65 3.49l2.005 2.004z" fill="#00ff73"/>
    </svg>
);


interface SelectionToolbarProps {
  selectedCount: number;
  onCopy?: () => void;
  onSend?: (format: 'csv' | 'md' | 'pdf') => void; // For exporting
  onAssign?: () => void;
  onSetDueDate?: () => void;
  onDelete?: () => void;
  onClear: () => void;
  onView?: () => void;
  onEdit?: () => void;
  onGenerateBriefs?: () => void; 
  onShareToSlack?: () => void;
  isSlackConnected?: boolean;
  onPushToGoogleTasks?: () => void;
  isGoogleTasksConnected?: boolean;
  onPushToTrello?: () => void;
  isTrelloConnected?: boolean;
}

const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  selectedCount,
  onCopy,
  onSend,
  onAssign,
  onSetDueDate,
  onDelete,
  onClear,
  onView,
  onEdit,
  onGenerateBriefs,
  onShareToSlack,
  isSlackConnected,
  onPushToGoogleTasks,
  isGoogleTasksConnected,
  onPushToTrello,
  isTrelloConnected,
}) => {
  const isOpen = selectedCount > 0;
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);


  const toolbarContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed bottom-0 left-0 right-0 z-50 flex justify-center p-4 pointer-events-none"
        >
          <div className="flex items-center gap-2 p-2 rounded-full bg-background border shadow-2xl pointer-events-auto">
            <div className="flex items-center gap-3 pr-2">
                 <Button variant="ghost" size="icon" onClick={onClear} className="h-8 w-8 rounded-full">
                    <X size={16} />
                </Button>
                <span className="text-sm font-medium text-foreground whitespace-nowrap">
                {selectedCount} item{selectedCount > 1 ? 's' : ''} selected
                </span>
            </div>
            <div className="h-6 border-l border-border" />
            <div className="flex items-center gap-1">
                {onView && (
                    <Button variant="ghost" size="sm" onClick={onView} className="rounded-full">
                        <Eye size={16} className="mr-2" /> View
                    </Button>
                )}
                {onEdit && (
                    <Button variant="ghost" size="sm" onClick={onEdit} className="rounded-full">
                        <Edit3 size={16} className="mr-2" /> Edit
                    </Button>
                )}
                 {onGenerateBriefs && (
                    <Button variant="ghost" size="sm" onClick={onGenerateBriefs} className="rounded-full">
                        <Brain size={16} className="mr-2" /> Briefs
                    </Button>
                )}
                {onAssign && (
                    <Button variant="ghost" size="sm" onClick={onAssign} className="rounded-full">
                        <UserPlus size={16} className="mr-2" /> Assign
                    </Button>
                )}
                {onSetDueDate && (
                    <Button variant="ghost" size="sm" onClick={onSetDueDate} className="rounded-full">
                        <CalendarDays size={16} className="mr-2" /> Due Date
                    </Button>
                )}
                
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                         <Button variant="ghost" size="sm" className="rounded-full">
                            <Send size={16} className="mr-2" /> Send / Export
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center">
                        {isGoogleTasksConnected && onPushToGoogleTasks && (
                           <DropdownMenuItem onSelect={onPushToGoogleTasks}>
                               <GoogleTasksIcon />
                               Push to Google Tasks
                           </DropdownMenuItem>
                        )}
                        {isTrelloConnected && onPushToTrello && (
                            <DropdownMenuItem onSelect={onPushToTrello}>
                                <SiTrello className="mr-2 h-4 w-4" color="#0079BF" />
                                Push to Trello
                            </DropdownMenuItem>
                        )}
                        {(isGoogleTasksConnected || isTrelloConnected) && <DropdownMenuSeparator />}
                        
                        {isSlackConnected && onShareToSlack && (
                           <DropdownMenuItem onSelect={onShareToSlack}>
                               <Slack size={14} className="mr-2" /> Share to Slack
                           </DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />
                        {onCopy && <DropdownMenuItem onSelect={onCopy}><Copy size={14} className="mr-2"/> Copy as Text</DropdownMenuItem>}
                        {onSend && (
                          <>
                            <DropdownMenuItem onSelect={() => onSend?.('pdf')}><FileDown size={14} className="mr-2"/> Export as PDF</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onSend?.('csv')}><FileDown size={14} className="mr-2"/> Export as CSV</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onSend?.('md')}><FileDown size={14} className="mr-2"/> Export as Markdown</DropdownMenuItem>
                          </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>

                {onDelete && (
                    <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive rounded-full">
                        <Trash2 size={16} className="mr-2" /> Delete
                    </Button>
                )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (!isMounted) {
    return null;
  }

  return ReactDOM.createPortal(toolbarContent, document.body);
};

export default SelectionToolbar;

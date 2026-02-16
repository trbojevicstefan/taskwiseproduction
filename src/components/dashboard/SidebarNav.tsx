// src/components/dashboard/SidebarNav.tsx
"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquare, CheckSquare, BarChart3, PlusCircle, Trash2, Edit3, Archive, Waypoints, Search, FolderOpen, MessageCircle as MessageCircleIcon, ListChecks as ListChecksIcon, LayoutTemplate, SquareKanban, Star, MoreVertical, Folder as FolderIcon, FolderPlus, X, Check, Users, Video, Calendar, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useChatHistory } from '@/contexts/ChatHistoryContext';
import { useFolders } from '@/contexts/FolderContext';
import type { Folder } from '@/types/folder';
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import React, { useState, useMemo, useCallback } from 'react';


const baseNavItems = [
  { href: '/meetings', label: 'Meetings', icon: Video },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/planning', label: 'Meeting Planner', icon: Calendar },
  { href: '/explore', label: 'Explore', icon: Search },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/people', label: 'People', icon: Users },
];

const truncateTitle = (title: string | undefined, maxLength: number = 22): string => {
  if (!title) return "Untitled";
  if (title.length <= maxLength) {
    return title;
  }
  return title.substring(0, maxLength) + "...";
};


export default function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { folders, addFolder, updateFolder, deleteFolder } = useFolders();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === 'collapsed';

  const {
    sessions: chatSessions,
    activeSessionId: activeChatSessionId,
    setActiveSessionId: setActiveChatSessionId,
    deleteSession: deleteChatSession,
    updateSessionTitle: updateChatSessionTitle,
    updateSession: updateChatSession,
    isLoadingHistory: isLoadingChatHistory,
  } = useChatHistory();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creatingFolderWithParent, setCreatingFolderWithParent] = useState<string | null | 'root'>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const workspaceId = user?.workspace?.id;

  const mainNavItems = useMemo(() => {
    const boardHref = workspaceId
      ? `/workspaces/${workspaceId}/board`
      : "/workspaces/unknown/board";

    return [
      baseNavItems[0],
      baseNavItems[1],
      baseNavItems[2],
      { href: boardHref, label: 'Board', icon: SquareKanban },
      baseNavItems[3],
      baseNavItems[4],
      baseNavItems[5],
    ];
  }, [workspaceId]);

  const handleEdit = (type: 'session' | 'folder', item: {id: string, title?: string, name?: string}) => {
    setEditingId(`${type}-${item.id}`);
    setNewTitle(item.title || item.name || "");
  };

  const handleSaveTitle = (type: 'session' | 'folder', item: any) => {
    if (newTitle.trim()) {
      if (type === 'folder') {
        updateFolder(item.id, { name: newTitle.trim() });
      } else {
         switch (item.type) {
           case 'chat': updateChatSessionTitle(item.id, newTitle.trim()); break;
         }
      }
    }
    setEditingId(null);
    setNewTitle("");
  };
  
  const handleSelectSession = (sessionType: 'chat', sessionId: string) => {
      switch (sessionType) {
        case 'chat':
            setActiveChatSessionId(sessionId);
            if (pathname !== '/chat') router.push('/chat');
            break;
    }
  };

  const handleMoveItemToFolder = (item: any, itemType: 'session' | 'folder', newParentId: string | null) => {
      if (itemType === 'folder') {
          updateFolder(item.id, { parentId: newParentId });
      } else {
          const updatePayload = { folderId: newParentId };
          switch (item.type) {
              case 'chat': updateChatSession(item.id, updatePayload); break;
          }
      }
  };
  
  const handleCreateFolder = (parentId: string | null) => {
    if (newFolderName.trim()) {
      addFolder({ name: newFolderName.trim(), parentId });
      setNewFolderName("");
      setCreatingFolderWithParent(null);
    }
  };

  const allHistoryItems = useMemo(() => {
    return [
      ...chatSessions.map(s => ({...s, type: 'chat', icon: s.sourceMeetingId ? Video : MessageCircleIcon})),
    ].sort((a: any, b: any) => {
        const timeA = a.lastActivityAt?.toMillis ? a.lastActivityAt.toMillis() : (a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0);
        const timeB = b.lastActivityAt?.toMillis ? b.lastActivityAt.toMillis() : (b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0);
        return timeB - timeA;
    });
  }, [chatSessions]);

  type FolderNode = Folder & { children: FolderNode[] };

  const folderStructure = useMemo(() => {
      const folderMap: Map<string, FolderNode> = new Map(
          folders.map(f => [f.id, { ...f, children: [] as FolderNode[] }])
      );
      const rootFolders: FolderNode[] = [];

      folders.forEach(f => {
          const folderWithChildren = folderMap.get(f.id)!;
          if (f.parentId && folderMap.has(f.parentId)) {
              folderMap.get(f.parentId)!.children.push(folderWithChildren);
          } else {
              rootFolders.push(folderWithChildren);
          }
      });
      return rootFolders;
  }, [folders]);

  // Recursive component for rendering folder dropdown menu items
  const renderFolderMenuItems = (
      folderList: FolderNode[], 
      onSelect: (folderId: string) => void,
      disabledFolderIds: Set<string> = new Set(),
      currentLevel = 0,
      maxDepth = 1, // A folder can be moved to root (level 0) or a level 0 folder (making it level 1)
    ) => {
      return folderList.map(folder => {
          const isDisabled = disabledFolderIds.has(folder.id) || currentLevel >= maxDepth;
          if (folder.children && folder.children.length > 0) {
              return (
                  <DropdownMenuSub key={folder.id}>
                      <DropdownMenuSubTrigger disabled={isDisabled}>
                          <FolderIcon className="mr-2 h-4 w-4" />
                          <span>{folder.name}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                          <DropdownMenuSubContent>
                              <DropdownMenuItem onClick={() => onSelect(folder.id)}>
                                  <FolderIcon className="mr-2 h-4 w-4" />
                                  <span>{folder.name} (root)</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator/>
                              {renderFolderMenuItems(folder.children, onSelect, disabledFolderIds, currentLevel + 1, maxDepth)}
                          </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                  </DropdownMenuSub>
              );
          }
          return (
              <DropdownMenuItem key={folder.id} onClick={() => onSelect(folder.id)} disabled={isDisabled}>
                  <FolderIcon className="mr-2 h-4 w-4" />
                  <span>{folder.name}</span>
              </DropdownMenuItem>
          );
      });
  };

  const getDescendantFolderIds = (folderId: string): Set<string> => {
      const descendants = new Set<string>();
      const folderMap: Map<string, FolderNode> = new Map(
        folders.map(f => [f.id, { ...f, children: [] as FolderNode[] }])
      );
      
      folders.forEach(f => {
          if (f.parentId) {
            folderMap.get(f.parentId)?.children.push(folderMap.get(f.id)!);
          }
      });
      
      const queue = [folderId];
      while(queue.length > 0) {
          const currentId = queue.shift()!;
          const folder = folderMap.get(currentId);
          folder?.children.forEach(child => {
              descendants.add(child.id);
              queue.push(child.id);
          });
      }
      return descendants;
  };


  const renderSessionItem = (session: any) => {
     const { id, title, type, icon: IconComponent, folderId, sourceMeetingId } = session;
     let isActive = false;
     let handleDelete = () => {};

     switch(type) {
         case 'chat':
            isActive = activeChatSessionId === id && pathname === '/chat';
            handleDelete = () => deleteChatSession(id);
            break;
     }

     const isEditing = editingId === `session-${id}`;

     const displayTitle = type === 'chat' && sourceMeetingId
        ? title.replace('Chat about "', '').slice(0,-1)
        : title;

     return (
        <div key={`${type}-${id}`} className="group relative flex items-center w-full rounded-md hover:bg-sidebar-accent/50">
            {isEditing ? (
                <div className="flex items-center gap-1 p-1 w-full">
                    <Input
                        type="text"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onBlur={() => handleSaveTitle('session', session)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle('session', session)}
                        className="h-7 text-xs flex-grow"
                        autoFocus
                    />
                </div>
            ) : (
              <div className="flex items-center w-full gap-1 group/item">
                <SidebarMenuButton
                    onClick={() => handleSelectSession(type, id)}
                    isActive={isActive}
                    tooltip={title}
                    size="sm"
                    className="flex-1 justify-start min-w-0 pr-8"
                >
                    <IconComponent size={12}/>
                    <span className="truncate" title={displayTitle}>{truncateTitle(displayTitle)}</span>
                </SidebarMenuButton>

                {!isCollapsed && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 z-10 h-6 w-6 -translate-y-1/2 rounded-full opacity-80 transition-opacity hover:opacity-100"
                        title="More options"
                      >
                        <MoreVertical size={12} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit('session', session)}>
                        <Edit3 size={14} className="mr-2"/> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <FolderOpen size={14} className="mr-2"/> Move to Folder
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent>
                            {renderFolderMenuItems(folderStructure, (newFolderId) => handleMoveItemToFolder(session, 'session', newFolderId))}
                            {folders.length === 0 && <DropdownMenuItem disabled>No folders created</DropdownMenuItem>}
                            {folderId && <DropdownMenuSeparator />}
                            {folderId && <DropdownMenuItem onClick={() => handleMoveItemToFolder(session, 'session', null)}>Unfile</DropdownMenuItem>}
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
                            <Trash2 size={14} className="mr-2"/> Delete
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>This will permanently delete "{truncateTitle(title, 50)}". This action cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
        </div>
     );
  }

  const renderFolderItem = useCallback((folder: Folder & { children: Folder[] }, level: number = 0) => {
    const isEditing = editingId === `folder-${folder.id}`;
    const sessionsInFolder = allHistoryItems.filter(item => item.folderId === folder.id);
    const disabledMoveFolderIds = new Set([folder.id, ...Array.from(getDescendantFolderIds(folder.id))]);
    const maxDepthReached = level >= 2;

    return (
        <Accordion type="single" key={folder.id} collapsible className="w-full">
            <AccordionItem value={`folder-content-${folder.id}`} className="border-b-0">
               <div className="group/folder-header relative flex items-center rounded-md hover:bg-sidebar-accent/50">
                   <AccordionTrigger className="py-0 flex-grow pr-14 text-sidebar-foreground/80 hover:no-underline justify-start">
                      <div className="flex-1 flex items-center text-sm font-medium min-w-0">
                         {isEditing ? (
                              <div className="flex items-center gap-1 w-full p-1">
                                  <Input
                                      type="text"
                                      value={newTitle}
                                      onChange={(e) => setNewTitle(e.target.value)}
                                      onBlur={() => handleSaveTitle('folder', folder)}
                                      onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle('folder', folder)}
                                      className="h-7 text-xs flex-grow"
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                  />
                              </div>
                          ) : (
                              <>
                                <FolderIcon size={14} className="mr-2 shrink-0"/>
                                <span className="truncate" title={folder.name}>{truncateTitle(folder.name, 22)}</span>
                              </>
                          )}
                      </div>
                   </AccordionTrigger>
                   {!isCollapsed && (
                     <div className="absolute right-1 top-1/2 z-10 flex items-center gap-1 -translate-y-1/2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-80 hover:opacity-100"
                          onClick={() => setCreatingFolderWithParent(folder.id)}
                          title="Add subfolder"
                          disabled={maxDepthReached}
                        >
                          <FolderPlus size={12} />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-80 hover:opacity-100" title="More options">
                              <MoreVertical size={12} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={() => handleEdit('folder', folder)}>
                              <Edit3 size={14} className="mr-2"/> Rename
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>
                                <FolderOpen size={14} className="mr-2"/> Move Folder
                              </DropdownMenuSubTrigger>
                              <DropdownMenuPortal>
                                <DropdownMenuSubContent>
                                  {renderFolderMenuItems(folderStructure, (newFolderId) => handleMoveItemToFolder(folder, 'folder', newFolderId), disabledMoveFolderIds, 0, 1)}
                                  {folder.parentId && <DropdownMenuSeparator />}
                                  {folder.parentId && <DropdownMenuItem onClick={() => handleMoveItemToFolder(folder, 'folder', null)}>Move to root</DropdownMenuItem>}
                                </DropdownMenuSubContent>
                              </DropdownMenuPortal>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator/>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive focus:text-destructive">
                                  <Trash2 size={14} className="mr-2"/> Delete
                                </DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent onClick={e => e.stopPropagation()}>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                  <AlertDialogDescription>This will delete the folder "{truncateTitle(folder.name, 50)}". Sessions and subfolders inside will be moved to the root.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteFolder(folder.id)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </DropdownMenuContent>
                        </DropdownMenu>
                     </div>
                   )}
               </div>
               <AccordionContent className="pl-5 pt-1 space-y-0.5">
                    {creatingFolderWithParent === folder.id && (
                        <div className="flex items-center gap-1.5 p-1">
                          <Input
                            type="text" placeholder="New subfolder..." value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder(folder.id)}
                            className="h-7 text-xs flex-grow" autoFocus
                          />
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCreateFolder(folder.id)}><Check size={16}/></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCreatingFolderWithParent(null)}><X size={16}/></Button>
                        </div>
                    )}
                    {folder.children.map(child => renderFolderItem(child as Folder & { children: Folder[] }, level + 1))}
                    {sessionsInFolder.map(renderSessionItem)}
                    {folder.children.length === 0 && sessionsInFolder.length === 0 && creatingFolderWithParent !== folder.id && (
                        <p className="px-2 py-1 text-xs text-sidebar-foreground/50">Folder is empty</p>
                    )}
               </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
  }, [allHistoryItems, folders, editingId, newTitle, creatingFolderWithParent, newFolderName, pathname, activeChatSessionId, folderStructure, isCollapsed]);

  const unfiledChats = useMemo(() => allHistoryItems.filter(item => item.type === 'chat' && !item.folderId), [allHistoryItems]);
  
  return (
    <nav className="flex flex-col h-full">
      <ScrollArea className="flex-grow">
      <div className="p-2 space-y-1">
        <SidebarMenu>
            {mainNavItems.map((item: any) => {
              const isActive = pathname.startsWith(item.href);
              return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.label}
                  size={isCollapsed ? "sm" : "default"}
                  className={cn(
                    "w-full",
                    isCollapsed ? "justify-center" : "justify-start",
                    isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Link href={item.href} prefetch={false}>
                    <item.icon className={cn(!isCollapsed && "mr-3")} />
                    {!isCollapsed && <span>{item.label}</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
      </div>

        {!isCollapsed && (
                <div className="px-2">
            <Accordion type="multiple" className="w-full" defaultValue={['folders', 'chats']}>
                <AccordionItem value="folders">
                     <div className="flex items-center justify-between py-2 text-sidebar-foreground/70 hover:text-sidebar-foreground/90 text-xs font-semibold">
                      <div className="flex items-center gap-2">
                          <FolderOpen size={14}/>
                          <span>{user?.workspace?.name || 'My Workspace'}</span>
                           <Button variant="ghost" size="icon" className="h-6 w-6 opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); setCreatingFolderWithParent('root'); }}>
                             <FolderPlus size={14}/>
                           </Button>
                      </div>
                      <AccordionTrigger className="p-0 hover:no-underline w-auto" />
                    </div>
                    <AccordionContent>
                      {creatingFolderWithParent === 'root' && (
                        <div className="flex items-center gap-1.5 p-1">
                          <Input
                            type="text" placeholder="New folder name..." value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder(null)}
                            className="h-7 text-xs flex-grow" autoFocus
                          />
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCreateFolder(null)}><Check size={16}/></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCreatingFolderWithParent(null)}><X size={16}/></Button>
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {folderStructure.length > 0 ? (
                           folderStructure.map(folder => renderFolderItem(folder, 0))
                        ) : (
                          creatingFolderWithParent !== 'root' && <p className="px-2 py-1 text-xs text-sidebar-foreground/50">No folders yet. Create one!</p>
                        )}
                      </div>
                    </AccordionContent>
                </AccordionItem>
                
                 {unfiledChats.length > 0 && (
                    <AccordionItem value="chats">
                        <AccordionTrigger className="text-sidebar-foreground/70 hover:no-underline hover:text-sidebar-foreground/90 text-xs font-semibold py-2">
                           <div className="flex items-center gap-2">
                              <MessageCircleIcon size={14}/>
                              <span>Chats</span>
                           </div>
                        </AccordionTrigger>
                        <AccordionContent>
                           <div className="space-y-0.5">
                              {unfiledChats.map(renderSessionItem)}
                           </div>
                        </AccordionContent>
                    </AccordionItem>
                 )}
                 {isLoadingChatHistory && (
                     <p className="px-2 py-4 text-xs text-sidebar-foreground/60">Loading history...</p>
                 )}

            </Accordion>
        </div>
        )}
      </ScrollArea>
      <div className="p-2 mt-auto border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="w-full justify-start hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              tooltip={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebar}
            >
              <PanelLeft />
              <span className="group-data-[collapsible=icon]:hidden">
                {isCollapsed ? "Expand" : "Collapse"}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </nav>
  );
}



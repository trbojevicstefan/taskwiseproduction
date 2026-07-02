// src/lib/exportUtils.ts
import type { ExtractedTaskSchema } from '@/types/chat';
import jsPDF from 'jspdf';
import Papa from 'papaparse';

// Helper to recursively flatten the task hierarchy for CSV
const flattenTasksForCSV = (tasks: ExtractedTaskSchema[], parentPath: string = ''): any[] => {
  let flatList: any[] = [];
  tasks.forEach((task, index) => {
    const currentPath = parentPath ? `${parentPath}.${index + 1}` : `${index + 1}`;
    flatList.push({
      'ID': currentPath,
      'Title': task.title,
      'Description': task.description || '',
      'Priority': task.priority,
      'Due Date': task.dueAt ? new Date(task.dueAt).toLocaleDateString() : '',
      'Assignee': task.assignee?.name || '',
      'Research Brief': task.researchBrief || '',
      'AI Assistance': task.aiAssistanceText || '',
    });
    if (task.subtasks) {
      flatList = flatList.concat(flattenTasksForCSV(task.subtasks, currentPath));
    }
  });
  return flatList;
};

// Export to CSV
export const exportTasksToCSV = (tasks: ExtractedTaskSchema[], filename: string) => {
  const flatTasks = flattenTasksForCSV(tasks);
  const csv = Papa.unparse(flatTasks);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Helper to recursively format tasks as Markdown with proper nesting
const formatTasksToMarkdown = (tasks: ExtractedTaskSchema[], level = 0): string => {
  let markdown = '';
  const indent = '  '.repeat(level);

  tasks.forEach(task => {
    // Main task item
    markdown += `${indent}- [ ] **${task.title}**`;
    if (task.assignee?.name) {
      markdown += ` (@${task.assignee.name})`;
    }
    markdown += `\n`;
    
    // Nested details with proper indentation and bullet points
    const detailIndent = '  '.repeat(level + 1);

    if (task.description) {
      markdown += `${detailIndent}- _${task.description.replace(/\n/g, `\n${detailIndent}  `)}_\n`;
    }
    if (task.priority) {
      markdown += `${detailIndent}- Priority: ${task.priority}\n`;
    }
    if (task.dueAt) {
      markdown += `${detailIndent}- Due: ${new Date(task.dueAt).toLocaleDateString()}\n`;
    }
    
    // Format AI content within blockquotes to not break the list flow
    if (task.researchBrief) {
      const formattedBrief = task.researchBrief.replace(/^/gm, `${detailIndent}> `);
      markdown += `${detailIndent}- ✨ **Research Brief:**\n${formattedBrief}\n`;
    }
    if (task.aiAssistanceText) {
        const formattedAssistance = task.aiAssistanceText.replace(/^/gm, `${detailIndent}> `);
        markdown += `${detailIndent}- ✨ **AI Assistance:**\n${formattedAssistance}\n`;
    }
    
    // Recursively add subtasks
    if (task.subtasks) {
      markdown += formatTasksToMarkdown(task.subtasks, level + 1);
    }
    markdown += `\n`; // Add a blank line between tasks for better readability
  });
  return markdown;
};

// Export to Markdown
export const exportTasksToMarkdown = (tasks: ExtractedTaskSchema[], filename: string) => {
  const markdownContent = formatTasksToMarkdown(tasks);
  const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-t8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Export to PDF
export const exportTasksToPDF = (tasks: ExtractedTaskSchema[], title: string) => {
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    const pageWidth = doc.internal.pageSize.width;
    const margin = 15;
    let cursorY = margin;
    let pageNumber = 1;

    const addPageIfNeeded = (spaceNeeded: number) => {
        if (cursorY + spaceNeeded > pageHeight - 20) {
            addFooter(); 
            doc.addPage();
            pageNumber++;
            cursorY = margin;
            // Optionally add a header to new pages
        }
    }

    const addFooter = () => {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(150);
      const footerText = `Generated with TaskWiseAI`;
      const pageText = `Page ${pageNumber}`;
      doc.text(footerText, margin, pageHeight - 10);
      doc.text(pageText, pageWidth - margin - doc.getStringUnitWidth(pageText) * doc.getFontSize() / doc.internal.scaleFactor, pageHeight - 10);
    };

    // --- Header ---
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(34, 139, 230); // Using a blue from the theme as an example
    doc.text(title, pageWidth / 2, cursorY + 8, { align: 'center' });
    
    cursorY += 25;

    doc.setDrawColor(230, 230, 230);
    doc.line(margin, cursorY - 10, pageWidth - margin, cursorY - 10);

    // --- Task Rendering Function ---
    const renderTasks = (tasksToRender: ExtractedTaskSchema[], level = 0) => {
        tasksToRender.forEach(task => {
            addPageIfNeeded(20); // Check for space before rendering a task

            const indent = margin + (level * 10);

            // --- Priority Bullets and Title ---
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0); // Explicitly set to black for titles

            const titleLines = doc.splitTextToSize(task.title, pageWidth - indent - margin - 20);
            const titleHeight = titleLines.length * 5;
            
            // Draw priority circles
            const priorityColors = { high: '#e53e3e', medium: '#d69e2e', low: '#38a169' };
            const priorityColor = priorityColors[task.priority] || '#cccccc';
            doc.setFillColor(priorityColor);
            const circleY = cursorY + 1.5;
            if (task.priority === 'high') {
                doc.circle(indent - 4, circleY, 1.2, 'F');
                doc.circle(indent, circleY, 1.2, 'F');
                doc.circle(indent + 4, circleY, 1.2, 'F');
            } else if (task.priority === 'medium') {
                doc.circle(indent - 2, circleY, 1.2, 'F');
                doc.circle(indent + 2, circleY, 1.2, 'F');
            } else {
                doc.circle(indent, circleY, 1.2, 'F');
            }

            doc.text(titleLines, indent + 10, cursorY + 3);
            cursorY += titleHeight + 2;

            const detailIndent = indent + 10;

            // --- Description ---
            if (task.description) {
                addPageIfNeeded(10);
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(80, 80, 80);
                const descLines = doc.splitTextToSize(task.description, pageWidth - detailIndent - margin);
                doc.text(descLines, detailIndent, cursorY);
                cursorY += descLines.length * 4.5 + 2;
            }

             // --- Due Date ---
             if (task.dueAt) {
                addPageIfNeeded(5);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'italic');
                doc.setTextColor(150, 150, 150);
                doc.text(`Due: ${new Date(task.dueAt).toLocaleDateString()}`, detailIndent, cursorY);
                cursorY += 5;
            }

            // --- AI Content ---
            const renderAiSection = (sectionTitle: string, content: string | null | undefined) => {
                if (!content) return;
                addPageIfNeeded(20);
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 102, 204);
                doc.text(`✨ ${sectionTitle}`, detailIndent, cursorY);
                cursorY += 5;

                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(50, 50, 50); // Use a dark gray for readability
                const briefLines = doc.splitTextToSize(content, pageWidth - detailIndent - margin);
                doc.text(briefLines, detailIndent, cursorY);
                cursorY += briefLines.length * 4 + 3;
            };

            renderAiSection('Research Brief', task.researchBrief);
            renderAiSection('AI Assistance', task.aiAssistanceText);
            
            cursorY += 6; // Space after each task item

            if (task.subtasks) {
                renderTasks(task.subtasks, level + 1);
            }
        });
    };

    renderTasks(tasks);
    addFooter();
    doc.save(`${title}.pdf`);
};


// Helper for "Copy to Clipboard"
export const formatTasksToText = (tasks: ExtractedTaskSchema[], level = 0): string => {
  let text = '';
  const indent = '  '.repeat(level);

  tasks.forEach(task => {
    text += `${indent}• ${task.title}\n`;
    if (task.description) {
      text += `${indent}  - ${task.description.replace(/\n/g, `\n${indent}    `)}\n`;
    }
    if (task.subtasks) {
      text += formatTasksToText(task.subtasks, level + 1);
    }
  });
  return text;
};

// New robust copy function with fallback
export const copyTextToClipboard = async (text: string): Promise<{ success: boolean; method: 'native' | 'fallback' }> => {
  // Try modern Clipboard API first
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true, method: 'native' };
    } catch (err) {
      console.warn('Clipboard API failed, falling back.', err);
      // Fall through to the legacy method
    }
  }

  // Fallback to legacy document.execCommand
  const textArea = document.createElement("textarea");
  textArea.value = text;
  // Make the textarea invisible
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return { success: successful, method: 'fallback' };
  } catch (err) {
    document.body.removeChild(textArea);
    console.error('Fallback copy method failed:', err);
    return { success: false, method: 'fallback' };
  }
};


// New function for native sharing
export const shareTasksNative = async (tasks: ExtractedTaskSchema[], title: string): Promise<{ success: boolean; method: 'native' | 'clipboard' | 'none' }> => {
  const textToShare = formatTasksToText(tasks);
  const shareData = {
    title: `Tasks from: ${title}`,
    text: textToShare,
  };

  const copyFallback = async () => {
    const { success } = await copyTextToClipboard(textToShare);
    return { success, method: 'clipboard' as const };
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return { success: true, method: 'native' };
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        console.log('Share was cancelled by the user.');
        return { success: false, method: 'native' };
      }
      // If any other error occurs (like NotAllowedError), fall back to clipboard.
      console.warn('Web Share API failed, falling back to clipboard:', error);
      return await copyFallback();
    }
  } else {
    // Fallback for desktop/unsupported browsers: copy to clipboard
    return await copyFallback();
  }
};

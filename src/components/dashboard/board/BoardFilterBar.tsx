"use client";

// src/components/dashboard/board/BoardFilterBar.tsx
//
// Search + filter controls for the board (Priority 11). All filters compose
// with AND and are persisted to the URL by the parent (BoardPageContent).

import React from "react";
import { Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardStatus } from "@/types/board";
import type { Person } from "@/types/person";
import type { TaskPriorityLabel } from "@/types/chat";
import {
  countActiveBoardFilters,
  hasActiveBoardFilters,
  DEFAULT_BOARD_FILTERS,
  PRIORITY_FILTER_OPTIONS,
  type BoardCompletionFilter,
  type BoardDueFilter,
  type BoardFilters,
} from "@/components/dashboard/board/board-filters";

const PRIORITY_TEXT: Record<TaskPriorityLabel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export interface BoardMeetingOption {
  id: string;
  name: string;
}

export interface BoardFilterBarProps {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
  people: Person[];
  statuses: BoardStatus[];
  meetingOptions: BoardMeetingOption[];
  companyOptions: string[];
}

const toggleValue = (values: string[], value: string, checked: boolean) => {
  const next = new Set(values);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return Array.from(next);
};

export default function BoardFilterBar({
  filters,
  onChange,
  people,
  statuses,
  meetingOptions,
  companyOptions,
}: BoardFilterBarProps) {
  const isFiltering = hasActiveBoardFilters(filters);
  const activeCount = countActiveBoardFilters(filters);

  const patch = (updates: Partial<BoardFilters>) =>
    onChange({ ...filters, ...updates });

  return (
    <>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(event) => patch({ search: event.target.value })}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="pl-9 w-64 bg-muted/60 border-transparent focus:bg-card"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Filter className="mr-2 h-4 w-4" />
            Filters
            {activeCount > 0 ? (
              <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                {activeCount}
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] w-72 overflow-y-auto">
          <DropdownMenuLabel>Assignee</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={filters.unassigned}
            onCheckedChange={(checked) => patch({ unassigned: Boolean(checked) })}
          >
            Unassigned
          </DropdownMenuCheckboxItem>
          {people.map((person) => (
            <DropdownMenuCheckboxItem
              key={person.id}
              checked={filters.assignees.includes(person.id)}
              onCheckedChange={(checked) =>
                patch({
                  assignees: toggleValue(
                    filters.assignees,
                    person.id,
                    Boolean(checked)
                  ),
                })
              }
            >
              {person.name}
            </DropdownMenuCheckboxItem>
          ))}

          {companyOptions.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Client / company</DropdownMenuLabel>
              {companyOptions.map((company) => (
                <DropdownMenuCheckboxItem
                  key={company}
                  checked={filters.companies.includes(company)}
                  onCheckedChange={(checked) =>
                    patch({
                      companies: toggleValue(
                        filters.companies,
                        company,
                        Boolean(checked)
                      ),
                    })
                  }
                >
                  {company}
                </DropdownMenuCheckboxItem>
              ))}
            </>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Due date</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filters.due}
            onValueChange={(value) => patch({ due: value as BoardDueFilter })}
          >
            <DropdownMenuRadioItem value="all">All dates</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="overdue">Overdue</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="today">Due today</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="this_week">This week</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="none">No due date</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Priority</DropdownMenuLabel>
          {PRIORITY_FILTER_OPTIONS.map((priority) => (
            <DropdownMenuCheckboxItem
              key={priority}
              checked={filters.priorities.includes(priority)}
              onCheckedChange={(checked) =>
                patch({
                  priorities: toggleValue(
                    filters.priorities,
                    priority,
                    Boolean(checked)
                  ) as TaskPriorityLabel[],
                })
              }
            >
              {PRIORITY_TEXT[priority]}
            </DropdownMenuCheckboxItem>
          ))}

          {meetingOptions.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Source meeting</DropdownMenuLabel>
              {meetingOptions.map((meeting) => (
                <DropdownMenuCheckboxItem
                  key={meeting.id}
                  checked={filters.meetings.includes(meeting.id)}
                  onCheckedChange={(checked) =>
                    patch({
                      meetings: toggleValue(
                        filters.meetings,
                        meeting.id,
                        Boolean(checked)
                      ),
                    })
                  }
                >
                  {meeting.name}
                </DropdownMenuCheckboxItem>
              ))}
            </>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Completion suggestion</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filters.completion}
            onValueChange={(value) =>
              patch({ completion: value as BoardCompletionFilter })
            }
          >
            <DropdownMenuRadioItem value="all">All tasks</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="suggested">
              Suggested done
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="none">
              Not suggested
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Column</DropdownMenuLabel>
          {statuses.map((status) => (
            <DropdownMenuCheckboxItem
              key={status.id}
              checked={
                filters.statuses.length === 0 ||
                filters.statuses.includes(status.id)
              }
              onCheckedChange={(checked) => {
                // Empty selection means "all columns"; materialize it before
                // toggling one off so the rest stay visible.
                const current = filters.statuses.length
                  ? filters.statuses
                  : statuses.map((entry) => entry.id);
                const next = toggleValue(current, status.id, Boolean(checked));
                patch({
                  statuses: next.length === statuses.length ? [] : next,
                });
              }}
            >
              {status.label}
            </DropdownMenuCheckboxItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onChange({ ...DEFAULT_BOARD_FILTERS })}
            disabled={!isFiltering}
          >
            Clear filters
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

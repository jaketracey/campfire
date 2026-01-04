'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, LifeBuoy, ChevronDown, Search, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  listSupportTickets,
  updateTicketStatus,
  sendTestEmail,
  type AdminSupportTicket,
  type TicketStatus,
  type SupportCategory,
} from '@/lib/api/support';
import { CreateTicketDialog } from '@/components/admin/create-ticket-dialog';
import { formatDistanceToNow, format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: 'Bug Report',
  feature_request: 'Feature Request',
  account: 'Account',
  billing: 'Billing',
  other: 'Other',
};

function getStatusBadgeClasses(status: TicketStatus): string {
  switch (status) {
    case 'open':
      return 'bg-amber-500/20 text-amber-400 border-0';
    case 'in_progress':
      return 'bg-blue-500/20 text-blue-400 border-0';
    case 'resolved':
      return 'bg-green-500/20 text-green-400 border-0';
    case 'closed':
      return 'bg-gray-500/20 text-gray-400 border-0';
    default:
      return 'bg-gray-500/20 text-gray-400 border-0';
  }
}

function getCategoryBadgeClasses(): string {
  return 'bg-white/5 text-gray-400 border-0 text-xs';
}

export default function AdminSupportPage() {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchTickets = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await listSupportTickets({
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch || undefined,
      });
      setTickets(response.data.tickets);
      setHasMore(response.data.hasMore);
      setTotal(response.data.total);
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
      toast({
        title: 'Error',
        description: 'Failed to load support tickets',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, toast]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleSendTestEmail = async () => {
    setIsSendingTestEmail(true);
    try {
      const response = await sendTestEmail();
      toast({
        title: 'Test Email Sent',
        description: `Test email queued for ${response.data.recipientEmail}`,
      });
    } catch (error) {
      console.error('Failed to send test email:', error);
      toast({
        title: 'Error',
        description: 'Failed to send test email. Is Redis running?',
        variant: 'destructive',
      });
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  const handleStatusChange = async (ticketId: string, newStatus: TicketStatus) => {
    try {
      await updateTicketStatus(ticketId, newStatus);
      toast({
        title: 'Status Updated',
        description: `Ticket status changed to ${STATUS_LABELS[newStatus]}.`,
      });
      fetchTickets();
    } catch (error) {
      console.error('Failed to update status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update ticket status',
        variant: 'destructive',
      });
    }
  };

  const handlePrevPage = () => {
    setPage(Math.max(1, page - 1));
  };

  const handleNextPage = () => {
    if (hasMore) {
      setPage(page + 1);
    }
  };

  const toggleExpand = (ticketId: string) => {
    setExpandedTicketId(expandedTicketId === ticketId ? null : ticketId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-white">Support Tickets</h1>
          <p className="text-gray-400 mt-1">Manage user support requests</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSendTestEmail}
            disabled={isSendingTestEmail}
            className="border-white/10 hover:bg-white/10 text-white"
          >
            <Mail className="mr-2 h-4 w-4" />
            {isSendingTestEmail ? 'Sending...' : 'Send Test Email'}
          </Button>
          <CreateTicketDialog onTicketCreated={fetchTickets} />
        </div>
      </div>

      {/* Main Card */}
      <Card className="bg-white/[0.02] border-white/5">
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-gray-400">
              <LifeBuoy className="h-4 w-4" />
              <span className="text-sm">
                {total} ticket{total !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  placeholder="Search subject or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64 bg-white/5 border-white/10 text-white placeholder:text-gray-500"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={fetchTickets}
                disabled={isLoading}
                className="border-white/10 hover:bg-white/10"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-pulse text-gray-500">Loading tickets...</div>
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <LifeBuoy className="h-12 w-12 mb-4 opacity-50" />
              <p>No support tickets</p>
              <p className="text-sm mt-1">
                {debouncedSearch ? 'Try a different search term' : 'Tickets will appear here when users submit them'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-gray-500 w-8"></TableHead>
                  <TableHead className="text-gray-500">User Email</TableHead>
                  <TableHead className="text-gray-500">Category</TableHead>
                  <TableHead className="text-gray-500">Subject</TableHead>
                  <TableHead className="text-gray-500">Status</TableHead>
                  <TableHead className="text-gray-500">Created</TableHead>
                  <TableHead className="text-gray-500 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <Fragment key={ticket.id}>
                    <TableRow
                      className="border-white/5 hover:bg-white/[0.02] cursor-pointer"
                      onClick={() => toggleExpand(ticket.id)}
                    >
                      <TableCell className="w-8">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-gray-400 hover:text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(ticket.id);
                          }}
                        >
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform',
                              expandedTicketId === ticket.id && 'rotate-180'
                            )}
                          />
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium text-white">
                        {ticket.userEmail}
                      </TableCell>
                      <TableCell>
                        <Badge className={getCategoryBadgeClasses()}>
                          {CATEGORY_LABELS[ticket.category] || ticket.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-300 max-w-xs truncate">
                        {ticket.subject}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusBadgeClasses(ticket.status)}>
                          {STATUS_LABELS[ticket.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-400 text-sm">
                        <span title={format(new Date(ticket.createdAt), 'PPpp')}>
                          {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                        </span>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-white/10 hover:bg-white/10 text-gray-300"
                            >
                              {STATUS_LABELS[ticket.status]}
                              <ChevronDown className="ml-2 h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-40 bg-zinc-900 border-white/10"
                          >
                            {(Object.keys(STATUS_LABELS) as TicketStatus[]).map((status) => (
                              <DropdownMenuItem
                                key={status}
                                onClick={() => handleStatusChange(ticket.id, status)}
                                className={cn(
                                  'cursor-pointer',
                                  ticket.status === status && 'bg-white/5'
                                )}
                              >
                                <span
                                  className={cn(
                                    'w-2 h-2 rounded-full mr-2',
                                    status === 'open' && 'bg-amber-400',
                                    status === 'in_progress' && 'bg-blue-400',
                                    status === 'resolved' && 'bg-green-400',
                                    status === 'closed' && 'bg-gray-400'
                                  )}
                                />
                                {STATUS_LABELS[status]}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {expandedTicketId === ticket.id && (
                      <TableRow className="border-white/5 bg-white/[0.01]">
                        <TableCell colSpan={7} className="px-6 py-4">
                          <div className="space-y-2">
                            <div className="text-sm text-gray-400">Message:</div>
                            <div className="text-gray-300 whitespace-pre-wrap bg-black/20 rounded-lg p-4">
                              {ticket.message}
                            </div>
                            <div className="text-xs text-gray-500 pt-2">
                              Last updated: {format(new Date(ticket.updatedAt), 'PPpp')}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {/* Pagination */}
        {!isLoading && tickets.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
            <p className="text-sm text-gray-500">
              Page {page}
              {hasMore ? '+' : ''} of {Math.ceil(total / PAGE_SIZE) || 1}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={page === 1}
                className="border-white/10 hover:bg-white/10"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={!hasMore}
                className="border-white/10 hover:bg-white/10"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

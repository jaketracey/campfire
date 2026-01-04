'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Check, Search, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  adminCreateTicket,
  type SupportCategory,
} from '@/lib/api/support';
import { listAdminUsers, type AdminUser } from '@/lib/api/admin';
import { cn } from '@/lib/utils';

interface CreateTicketDialogProps {
  onTicketCreated?: () => void;
}

const CATEGORY_OPTIONS: { value: SupportCategory; label: string }[] = [
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'account', label: 'Account Issue' },
  { value: 'billing', label: 'Billing' },
  { value: 'other', label: 'Other' },
];

export function CreateTicketDialog({ onTicketCreated }: CreateTicketDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [category, setCategory] = useState<SupportCategory>('other');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // User search state
  const [userSearch, setUserSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Debounce user search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(userSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [userSearch]);

  // Fetch users when search changes
  const searchUsers = useCallback(async () => {
    if (!debouncedSearch) {
      setUsers([]);
      return;
    }
    setIsSearching(true);
    try {
      const response = await listAdminUsers({
        search: debouncedSearch,
        limit: 10,
        status: 'active',
      });
      setUsers(response.data.users);
    } catch (err) {
      console.error('Failed to search users:', err);
      setUsers([]);
    } finally {
      setIsSearching(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    searchUsers();
  }, [searchUsers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUser) {
      setError('Please select a user');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await adminCreateTicket({
        userId: selectedUser.id,
        category,
        subject,
        message,
      });

      setSuccess(true);
      onTicketCreated?.();
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to create ticket');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    // Reset form after close animation
    setTimeout(() => {
      setSelectedUser(null);
      setCategory('other');
      setSubject('');
      setMessage('');
      setError(null);
      setSuccess(false);
      setUserSearch('');
      setUsers([]);
    }, 200);
  };

  const handleUserSelect = (user: AdminUser) => {
    setSelectedUser(user);
    setUserSearch(user.email);
    setShowUserDropdown(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => isOpen ? setOpen(true) : handleClose()}>
      <DialogTrigger asChild>
        <Button className="bg-campfire-600 hover:bg-campfire-500 text-white">
          <Plus className="mr-2 h-4 w-4" />
          Create Ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-zinc-950 border border-white/10 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Create Support Ticket</DialogTitle>
          <DialogDescription className="text-gray-400">
            Create a ticket on behalf of a user. They will receive an email notification.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <Check className="h-5 w-5 text-green-500" />
              <p className="text-green-500 text-sm">
                Ticket created for {selectedUser?.email}
              </p>
            </div>
            <p className="text-gray-400 text-sm">
              The user has been notified via email about this support ticket.
            </p>
            <DialogFooter>
              <Button
                onClick={handleClose}
                className="bg-campfire-600 hover:bg-campfire-500 text-white w-full"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {/* User Search */}
            <div className="space-y-2">
              <Label htmlFor="user" className="text-gray-400">
                User
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  id="user"
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value);
                    setSelectedUser(null);
                    setShowUserDropdown(true);
                  }}
                  onFocus={() => setShowUserDropdown(true)}
                  placeholder="Search by email..."
                  className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-gray-600"
                />
                {/* User Dropdown */}
                {showUserDropdown && (userSearch || isSearching) && (
                  <div className="absolute z-50 w-full mt-1 bg-zinc-900 border border-white/10 rounded-md shadow-lg max-h-48 overflow-auto">
                    {isSearching ? (
                      <div className="px-3 py-2 text-gray-500 text-sm">Searching...</div>
                    ) : users.length === 0 && debouncedSearch ? (
                      <div className="px-3 py-2 text-gray-500 text-sm">No users found</div>
                    ) : (
                      users.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => handleUserSelect(user)}
                          className={cn(
                            'w-full px-3 py-2 text-left hover:bg-white/5 flex items-center gap-2',
                            selectedUser?.id === user.id && 'bg-white/10'
                          )}
                        >
                          <User className="h-4 w-4 text-gray-500" />
                          <span className="text-white text-sm">{user.email}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {selectedUser && (
                <p className="text-xs text-green-500">
                  Selected: {selectedUser.email}
                </p>
              )}
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category" className="text-gray-400">
                Category
              </Label>
              <Select value={category} onValueChange={(v) => setCategory(v as SupportCategory)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-white/10">
                  {CATEGORY_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-white hover:bg-white/10 focus:bg-white/10"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="subject" className="text-gray-400">
                Subject
              </Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief description of the issue"
                required
                maxLength={255}
                className="bg-white/5 border-white/10 text-white placeholder:text-gray-600"
              />
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="message" className="text-gray-400">
                Message
              </Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Detailed description of the issue or request..."
                rows={4}
                required
                minLength={10}
                maxLength={10000}
                className="bg-white/5 border-white/10 text-white placeholder:text-gray-600 resize-none"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-500 text-sm">{error}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="border-white/10 hover:bg-white/10 text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isLoading || !selectedUser}
                className="bg-campfire-600 hover:bg-campfire-500 text-white"
              >
                {isLoading ? 'Creating...' : 'Create Ticket'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

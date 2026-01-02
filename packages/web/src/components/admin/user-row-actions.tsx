'use client';

import { useState } from 'react';
import { MoreHorizontal, KeyRound, UserX, UserCheck, Shield, ShieldOff, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  resetUserPassword,
  setUserRole,
  suspendUser,
  unsuspendUser,
  grantUserTokens,
  type AdminUser,
} from '@/lib/api/admin';

interface UserRowActionsProps {
  user: AdminUser;
  onActionComplete: () => void;
}

type DialogType = 'resetPassword' | 'suspend' | 'unsuspend' | 'makeAdmin' | 'removeAdmin' | 'grantTokens' | null;

export function UserRowActions({ user, onActionComplete }: UserRowActionsProps) {
  const [openDialog, setOpenDialog] = useState<DialogType>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [tokenAmount, setTokenAmount] = useState('1000');

  const handleAction = async () => {
    setIsLoading(true);
    try {
      switch (openDialog) {
        case 'resetPassword':
          await resetUserPassword(user.id);
          break;
        case 'suspend':
          await suspendUser(user.id);
          break;
        case 'unsuspend':
          await unsuspendUser(user.id);
          break;
        case 'makeAdmin':
          await setUserRole(user.id, 'admin');
          break;
        case 'removeAdmin':
          await setUserRole(user.id, 'user');
          break;
        case 'grantTokens':
          await grantUserTokens(user.id, { amount: parseInt(tokenAmount, 10) });
          setTokenAmount('1000'); // Reset for next time
          break;
      }
      onActionComplete();
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setIsLoading(false);
      setOpenDialog(null);
    }
  };

  const dialogConfig: Record<Exclude<DialogType, null>, {
    title: string;
    description: string;
    actionLabel: string;
    variant: 'default' | 'destructive';
  }> = {
    resetPassword: {
      title: 'Send Password Reset Email',
      description: `Are you sure you want to send a password reset email to ${user.email}?`,
      actionLabel: 'Send Reset Email',
      variant: 'default',
    },
    suspend: {
      title: 'Suspend User',
      description: `Are you sure you want to suspend ${user.email}? They will not be able to sign in until unsuspended.`,
      actionLabel: 'Suspend User',
      variant: 'destructive',
    },
    unsuspend: {
      title: 'Unsuspend User',
      description: `Are you sure you want to unsuspend ${user.email}? They will be able to sign in again.`,
      actionLabel: 'Unsuspend User',
      variant: 'default',
    },
    makeAdmin: {
      title: 'Grant Admin Access',
      description: `Are you sure you want to make ${user.email} an admin? They will have full access to the admin panel.`,
      actionLabel: 'Grant Admin',
      variant: 'default',
    },
    removeAdmin: {
      title: 'Remove Admin Access',
      description: `Are you sure you want to remove admin access from ${user.email}?`,
      actionLabel: 'Remove Admin',
      variant: 'destructive',
    },
    grantTokens: {
      title: 'Grant Tokens',
      description: `Grant tokens to ${user.email}. These tokens can be used for gifts and other features.`,
      actionLabel: 'Grant Tokens',
      variant: 'default',
    },
  };

  const currentDialog = openDialog ? dialogConfig[openDialog] : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-gray-400 hover:text-white"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-48 bg-zinc-900 border-white/10"
        >
          <DropdownMenuItem
            onClick={() => setOpenDialog('resetPassword')}
            className="cursor-pointer"
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Reset Password
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setOpenDialog('grantTokens')}
            className="cursor-pointer text-amber-400 focus:text-amber-400"
          >
            <Coins className="mr-2 h-4 w-4" />
            Grant Tokens
          </DropdownMenuItem>

          <DropdownMenuSeparator className="bg-white/10" />

          {user.status === 'active' ? (
            <DropdownMenuItem
              onClick={() => setOpenDialog('suspend')}
              className="cursor-pointer text-red-400 focus:text-red-400"
            >
              <UserX className="mr-2 h-4 w-4" />
              Suspend User
            </DropdownMenuItem>
          ) : user.status === 'suspended' ? (
            <DropdownMenuItem
              onClick={() => setOpenDialog('unsuspend')}
              className="cursor-pointer text-green-400 focus:text-green-400"
            >
              <UserCheck className="mr-2 h-4 w-4" />
              Unsuspend User
            </DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator className="bg-white/10" />

          {user.role === 'admin' ? (
            <DropdownMenuItem
              onClick={() => setOpenDialog('removeAdmin')}
              className="cursor-pointer text-red-400 focus:text-red-400"
            >
              <ShieldOff className="mr-2 h-4 w-4" />
              Remove Admin
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => setOpenDialog('makeAdmin')}
              className="cursor-pointer text-campfire-400 focus:text-campfire-400"
            >
              <Shield className="mr-2 h-4 w-4" />
              Make Admin
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={!!openDialog} onOpenChange={(open) => !open && setOpenDialog(null)}>
        <AlertDialogContent className="bg-zinc-950 border border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {currentDialog?.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              {currentDialog?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {openDialog === 'grantTokens' && (
            <div className="py-4">
              <Label htmlFor="tokenAmount" className="text-sm font-medium text-gray-300">
                Token Amount
              </Label>
              <Input
                id="tokenAmount"
                type="number"
                min="1"
                max="1000000"
                value={tokenAmount}
                onChange={(e) => setTokenAmount(e.target.value)}
                className="mt-2 bg-white/5 border-white/10 text-white"
                placeholder="Enter amount..."
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isLoading}
              className="bg-white/5 border-white/10 hover:bg-white/10 text-white"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAction}
              disabled={isLoading}
              className={
                currentDialog?.variant === 'destructive'
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-campfire-600 hover:bg-campfire-500 text-white'
              }
            >
              {isLoading ? 'Processing...' : currentDialog?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

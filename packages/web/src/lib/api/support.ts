/**
 * Support API
 * Create and manage support tickets.
 */

import { get, patch, post } from './client';

/**
 * Support ticket category (matches backend schema)
 */
export type SupportCategory = 'bug' | 'feature_request' | 'account' | 'billing' | 'other';

/**
 * Create support ticket request
 */
export interface CreateSupportTicketRequest {
  category: SupportCategory;
  subject: string;
  message: string;
}

/**
 * Support ticket response
 */
export interface SupportTicket {
  id: string;
  category: SupportCategory;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
}

/**
 * Create support ticket response
 */
export interface CreateSupportTicketResponse {
  ticket: SupportTicket;
}

/**
 * Create a new support ticket
 */
export async function createSupportTicket(
  request: CreateSupportTicketRequest
): Promise<SupportTicket> {
  const response = await post<CreateSupportTicketResponse>(
    '/support/tickets',
    request
  );
  return response.ticket;
}

// ============================================================================
// Admin Types
// ============================================================================

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface AdminSupportTicket {
  id: string;
  userId: string;
  userEmail: string;
  category: SupportCategory;
  subject: string;
  message: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSupportTicketListResponse {
  success: boolean;
  data: {
    tickets: AdminSupportTicket[];
    hasMore: boolean;
    total: number;
  };
}

export interface AdminSupportTicketListOptions {
  page?: number;
  limit?: number;
  status?: TicketStatus;
  search?: string;
}

export interface UpdateTicketStatusResponse {
  success: boolean;
  data: {
    ticket: AdminSupportTicket;
  };
}

// ============================================================================
// Admin API Methods
// ============================================================================

/**
 * List support tickets (admin only)
 */
export function listSupportTickets(
  options?: AdminSupportTicketListOptions
): Promise<AdminSupportTicketListResponse> {
  return get<AdminSupportTicketListResponse>(
    '/admin/support/tickets',
    options as Record<string, string | number | boolean | undefined>
  );
}

/**
 * Update ticket status (admin only)
 */
export function updateTicketStatus(
  ticketId: string,
  status: TicketStatus
): Promise<UpdateTicketStatusResponse> {
  return patch<UpdateTicketStatusResponse>(`/admin/support/tickets/${ticketId}`, { status });
}

// ============================================================================
// Admin Test Email
// ============================================================================

export interface SendTestEmailResponse {
  success: boolean;
  data: {
    message: string;
    jobId: string;
    recipientEmail: string;
  };
}

/**
 * Send test email to verify SES configuration (admin only)
 */
export function sendTestEmail(): Promise<SendTestEmailResponse> {
  return post<SendTestEmailResponse>('/admin/support/test-email', {});
}

// ============================================================================
// Admin Create Ticket
// ============================================================================

export interface AdminCreateTicketRequest {
  userId: string;
  category: SupportCategory;
  subject: string;
  message: string;
}

export interface AdminCreateTicketResponse {
  success: boolean;
  data: {
    ticket: AdminSupportTicket;
    emailQueued: boolean;
  };
}

/**
 * Create a support ticket on behalf of a user (admin only)
 */
export function adminCreateTicket(
  request: AdminCreateTicketRequest
): Promise<AdminCreateTicketResponse> {
  return post<AdminCreateTicketResponse>('/admin/support/tickets', request);
}

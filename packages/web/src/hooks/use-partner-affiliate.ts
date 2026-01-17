'use client';

import { useState, useEffect } from 'react';
import { validateAffiliateCode } from '@/lib/api/affiliates';

const COOKIE_NAME = 'campfire_aff';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
}

function setCookie(name: string, value: string, days: number): void {
  if (typeof document === 'undefined') return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

interface UsePartnerAffiliateResult {
  affiliateCode: string | null;
  isValidating: boolean;
  isValid: boolean;
  affiliateName: string | null;
}

/**
 * Hook to read and validate affiliate code from URL param or cookie.
 * Stores valid codes in a cookie for persistence across page navigations.
 */
export function usePartnerAffiliate(): UsePartnerAffiliateResult {
  const [affiliateCode, setAffiliateCode] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [affiliateName, setAffiliateName] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      // Get code from URL param first, then fallback to cookie
      const urlParams = new URLSearchParams(window.location.search);
      const refParam = urlParams.get('ref') || urlParams.get('aff');
      const cookieCode = getCookie(COOKIE_NAME);
      const code = refParam || cookieCode;

      if (!code) {
        return;
      }

      setAffiliateCode(code);
      setIsValidating(true);

      try {
        const result = await validateAffiliateCode(code);
        if (result.data.valid) {
          setIsValid(true);
          setAffiliateName(result.data.affiliateName || null);

          // Store in cookie if it came from URL
          if (refParam && refParam !== cookieCode) {
            setCookie(COOKIE_NAME, code, 30); // 30 days
          }
        } else {
          setIsValid(false);
          setAffiliateCode(null);
        }
      } catch {
        // Silent fail - don't block the page
        setIsValid(false);
      } finally {
        setIsValidating(false);
      }
    };

    init();
  }, []);

  return {
    affiliateCode: isValid ? affiliateCode : null,
    isValidating,
    isValid,
    affiliateName,
  };
}

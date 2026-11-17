// @ts-check
/**
 * Data minimisation: remove contact details from listing text before it goes to an
 * AI provider. Agents' and sellers' phone numbers and email addresses aren't needed
 * to assess a home, and they are other people's personal data.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
// A run that starts with "+", "(0" or "0" and continues on the same line with digits,
// spaces, dots, hyphens or brackets. Prices (£…), decimals and long reference numbers
// are left alone by the look-behind and the digit count below.
const PHONE = /(?<![\w£$€.,/])(?:\+|\(?0)[\d \t\u00a0().-]{8,22}\d(?!\w)/g;

/**
 * @param {string} text
 * @returns {{ text: string, emails: number, phones: number }}
 */
export function redactContactDetails(text) {
  let emails = 0;
  let phones = 0;
  const withoutEmails = text.replace(EMAIL, () => {
    emails++;
    return '[email address removed]';
  });
  const out = withoutEmails.replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, '').length;
    if (digits < 10 || digits > 13) return match;
    phones++;
    return '[phone number removed]';
  });
  return { text: out, emails, phones };
}

// src/app/terms/page.tsx
import LegalPageLayout from '@/components/layouts/LegalPageLayout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Terms of Service | TaskWiseAI',
    description: 'Terms of Service for the TaskWiseAI application.',
};

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service">
        <p>Last updated: December 29, 2025</p>

        <h2>1. Acceptance of These Terms</h2>
        <p>By accessing or using the Service, you agree to these Terms of Service. If you do not agree, do not use the Service.</p>

        <h2>2. Eligibility</h2>
        <p>You must be at least 13 years old to use the Service. If you are using the Service on behalf of an organization, you represent that you have authority to bind that organization to these Terms.</p>

        <h2>3. Accounts and Security</h2>
        <p>You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account.</p>

        <h2>4. The Service</h2>
        <p>TaskWiseAI provides task management, AI-powered task extraction, meeting insights, and integrations with third-party services. We may update or modify the Service from time to time.</p>

        <h2>5. Your Content</h2>
        <p>You retain ownership of content you submit. You grant TaskWiseAI a worldwide, royalty-free license to host, store, reproduce, modify, and process your content solely to provide and improve the Service, including sending content to AI model providers for processing.</p>

        <h2>6. Acceptable Use</h2>
        <p>You agree not to misuse the Service. For example, you will not:</p>
        <ul>
            <li>Use the Service for illegal activities or in violation of applicable laws.</li>
            <li>Upload content that is unlawful, harmful, infringing, or otherwise objectionable.</li>
            <li>Attempt to interfere with or compromise the integrity or security of the Service.</li>
            <li>Reverse engineer or attempt to extract source code from the Service.</li>
        </ul>

        <h2>7. Third-Party Services</h2>
        <p>If you connect third-party services, their terms and policies apply to your use of those services. TaskWiseAI is not responsible for third-party services.</p>

        <h2>8. Fees and Billing</h2>
        <p>Some plans may require payment. Prices and features are described on our pricing pages and may change with notice. Taxes may apply.</p>

        <h2>9. Suspension and Termination</h2>
        <p>We may suspend or terminate your access if you violate these Terms or if required to protect the Service or other users. You may stop using the Service at any time.</p>

        <h2>10. Disclaimer</h2>
        <p>The Service is provided on an "as is" and "as available" basis, without warranties of any kind.</p>

        <h2>11. Limitation of Liability</h2>
        <p>To the fullest extent permitted by law, TaskWiseAI will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenues, data, or goodwill arising from your use of the Service.</p>

        <h2>12. Indemnification</h2>
        <p>You agree to indemnify and hold TaskWiseAI harmless from claims, damages, and expenses arising from your use of the Service or violation of these Terms.</p>

        <h2>13. Changes to These Terms</h2>
        <p>We may update these Terms from time to time. We will post the latest version on this page.</p>

        <h2>14. Contact Us</h2>
        <p>If you have questions about these Terms, contact us at: support@taskwise.ai</p>
    </LegalPageLayout>
  );
}

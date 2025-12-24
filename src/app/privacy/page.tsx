// src/app/privacy/page.tsx
import LegalPageLayout from '@/components/layouts/LegalPageLayout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy | TaskWiseAI',
    description: 'Privacy Policy for the TaskWiseAI application.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy">
        <p>Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        
        <h2>1. Introduction</h2>
        <p>Welcome to TaskWiseAI. We are committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our application.</p>
        
        <h2>2. Information We Collect</h2>
        <p>We may collect information about you in a variety of ways. The information we may collect on the Service includes:</p>
        <ul>
            <li><strong>Personal Data:</strong> Personally identifiable information, such as your name, email address, and profile picture, that you voluntarily give to us when you register with the application or when you connect third-party services.</li>
            <li><strong>Task and Content Data:</strong> All content you create or submit, including tasks, notes, meeting transcripts, and any text processed by our AI services.</li>
            <li><strong>Integration Data:</strong> When you connect third-party services like Google, Trello, or Slack, we may receive information from those services as authorized by you during the connection process. This may include profile information, team information, and content required for the integration to function.</li>
            <li><strong>Usage Data:</strong> Information our servers automatically collect when you access the Service, such as your IP address, your browser type, your operating system, your access times, and the pages you have viewed directly before and after accessing the Service.</li>
        </ul>

        <h2>3. Use of Your Information</h2>
        <p>Having accurate information about you permits us to provide you with a smooth, efficient, and customized experience. Specifically, we may use information collected about you via the Service to:</p>
        <ul>
            <li>Create and manage your account.</li>
            <li>Process your text and meeting transcripts through our AI models to generate tasks, summaries, and other insights.</li>
            <li>Enable integrations with third-party services like Slack, Google Tasks, and Trello.</li>
            <li>Email you regarding your account or order.</li>
            <li>Improve the efficiency and operation of the Service.</li>
            <li>Monitor and analyze usage and trends to improve your experience with the Service.</li>
        </ul>

        <h2>4. Disclosure of Your Information</h2>
        <p>We do not share your information with third parties except as described in this Privacy Policy. We may share information we have collected about you in certain situations:</p>
        <ul>
            <li><strong>With Your Consent:</strong> We may share your information with third parties when you have given us consent to do so, such as when you connect an integration.</li>
            <li><strong>By Law or to Protect Rights:</strong> If we believe the release of information about you is necessary to respond to legal process, to investigate or remedy potential violations of our policies, or to protect the rights, property, and safety of others, we may share your information as permitted or required by any applicable law, rule, or regulation.</li>
            <li><strong>Third-Party Service Providers:</strong> We may share your information with third parties that perform services for us or on our behalf, including data analysis, email delivery, hosting services, and AI model processing (such as Google Generative AI).</li>
        </ul>

        <h2>5. Security of Your Information</h2>
        <p>We use administrative, technical, and physical security measures to help protect your personal information. While we have taken reasonable steps to secure the personal information you provide to us, please be aware that despite our efforts, no security measures are perfect or impenetrable, and no method of data transmission can be guaranteed against any interception or other type of misuse.</p>

        <h2>6. Contact Us</h2>
        <p>If you have questions or comments about this Privacy Policy, please contact us at: privacy@taskwise.ai</p>
    </LegalPageLayout>
  );
}

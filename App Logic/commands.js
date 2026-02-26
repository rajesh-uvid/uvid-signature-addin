/*
 * UVID Consulting - Background Signature Logic
 * Fetches user profile (job title, phone) from Microsoft Graph API via SSO.
 * No employees.json required — data comes directly from M365 / Azure AD.
 *
 * AZURE TENANT: 666ce4e4-0e70-42c4-bf70-cf444455f075
 *
 * SETUP REQUIRED:
 *   1. Register an Azure AD app at https://portal.azure.com > App registrations
 *      (Tenant: 666ce4e4-0e70-42c4-bf70-cf444455f075)
 *   2. Grant the app "User.Read" delegated permission (Microsoft Graph)
 *   3. Add an "Expose an API" scope with URI:
 *      api://rajesh-uvid.github.io/uvid-signature-addin/666ce4e4-0e70-42c4-bf70-cf444455f075/<YOUR_APP_CLIENT_ID>
 *   4. Replace YOUR_AZURE_APP_CLIENT_ID in manifest.xml WebApplicationInfo
 *      with the Application (client) ID from the App registrations > Overview page.
 */

// Banner configuration — update these if the banner changes
const BANNER_IMAGE_URL = "https://rajesh-uvid.github.io/uvid-signature-addin/assets/image/banner/banner.png";
const BANNER_LINK = "https://www.uvidconsulting.com";
const BANNER_ALT = "UVID Consulting";

Office.onReady(() => {
    // Add-in initialized
});

/**
 * Handles the OnNewMessageCompose / OnNewAppointmentOrganizer events.
 * Triggered automatically when the user clicks "New Email" or "New Meeting".
 */
async function onMessageComposeHandler(event) {
    try {
        // ── Step 1: Get SSO token silently via OfficeRuntime ────────────
        // No popup needed — user is already signed in to M365.
        try {
            // Use Office.auth.getAccessToken which is the standard for Outlook SSO
            accessToken = await Office.auth.getAccessToken({
                allowSignInPrompt: true,
                allowConsentPrompt: true,
                forMSGraphAccess: true
            });
        } catch (tokenErr) {
            console.error("SSO token error:", tokenErr);
            // Fallback: insert a generic signature if SSO fails
            await insertGenericSignature(event);
            return;
        }

        // ── Step 2: Fetch profile from Microsoft Graph /me ───────────────
        // Gets: displayName, mail, jobTitle, businessPhones, mobilePhone
        const graphResponse = await fetch(
            "https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle,businessPhones,mobilePhone",
            {
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        if (!graphResponse.ok) {
            throw new Error(`Graph API error: ${graphResponse.status}`);
        }

        const profile = await graphResponse.json();

        const name = profile.displayName || Office.context.mailbox.userProfile.displayName;
        const email = profile.mail || profile.userPrincipalName || Office.context.mailbox.userProfile.emailAddress;
        const designation = profile.jobTitle || "Consultant";
        const phone = (profile.businessPhones && profile.businessPhones[0])
            || profile.mobilePhone || "";

        // ── Step 3: Build and insert the HTML signature ──────────────────
        await insertSignature(event, name, email, designation, phone);

    } catch (error) {
        console.error("Error generating UVID signature:", error);
        // Fail gracefully — user can still write and send email
        event.completed({ allowEvent: true });
    }
}

/**
 * Builds and injects the HTML signature into the compose window.
 */
async function insertSignature(event, name, email, designation, phone) {
    const phoneHtml = phone ? `M: ${esc(phone)} | ` : "";

    const signatureHtml = `
        <br/><br/>
        <div style="font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #444;">
            <p style="margin: 0; padding: 0;"><strong>${esc(name)}</strong></p>
            <p style="margin: 0; padding: 0; color: #005A9E;">${esc(designation)} | UVID Consulting</p>
            <p style="margin: 0; padding: 0;">${phoneHtml}E: <a href="mailto:${esc(email)}" style="color: #005A9E;">${esc(email)}</a></p>
            <p style="margin-top: 10px;">
                <a href="${BANNER_LINK}">
                    <img src="${BANNER_IMAGE_URL}" alt="${BANNER_ALT}" style="max-width: 450px; height: auto; border-radius: 4px;"/>
                </a>
            </p>
        </div>
    `;

    Office.context.mailbox.item.body.setSignatureAsync(
        signatureHtml,
        { coercionType: Office.CoercionType.Html },
        function (asyncResult) {
            if (asyncResult.status === Office.AsyncResultStatus.Failed) {
                console.error("Signature injection failed:", asyncResult.error.message);
            }
            event.completed({ allowEvent: true });
        }
    );
}

/**
 * Fallback: insert a minimal signature using only the Outlook profile
 * (no Graph API — name and email only, no designation or phone).
 */
async function insertGenericSignature(event) {
    const profile = Office.context.mailbox.userProfile;
    await insertSignature(event, profile.displayName, profile.emailAddress, "UVID Consulting", "");
}

/** Prevent XSS when interpolating user data into HTML */
function esc(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Map the handler so the manifest LaunchEvent can find it
Office.actions.associate("onMessageComposeHandler", onMessageComposeHandler);

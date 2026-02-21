/*
 * UVID Consulting - Background Signature Logic
 * Hosted on OneDrive via public link.
 */

// Define SharePoint URLs (Private to org)
// IMPORTANT: Update these to the actual raw file paths on your SharePoint site.
const SHAREPOINT_EMPLOYEES_URL = "https://key65akcdgsfg2zhwxauifkam1a.sharepoint.com/:u:/s/UVIDEmailSignature/IQDv-trekFKmQaYKrONKww9yAZegYOKOKBX3JoyXASLrYns?e=x0Fc5t";
const SHAREPOINT_BANNER_CONFIG_URL = "https://key65akcdgsfg2zhwxauifkam1a.sharepoint.com/:u:/s/UVIDEmailSignature/IQBdttIVb3lpQZBIl0xmZI4HAf32nZfDPjyfiU5LCYajX6c";

Office.onReady(() => {
    // Add-in initialized
});

/**
 * Handles the OnNewMessageCompose event.
 * Triggered automatically when a user clicks "New Email".
 */
async function onMessageComposeHandler(event) {
    try {
        // 1. Get identity from Outlook profile (instant, zero auth)
        const userProfile = Office.context.mailbox.userProfile;
        const email = userProfile.emailAddress;
        const name = userProfile.displayName;

        // Fetch options: 'include' credentials to use the user's existing M365 session cookies for SharePoint
        const fetchOptions = { credentials: 'include', cache: 'no-store' };

        // 2. Fetch employee data from SharePoint
        const empResponse = await fetch(SHAREPOINT_EMPLOYEES_URL, fetchOptions);
        const employeesList = await empResponse.json();

        // Find current user's details, fallback to generic if not found
        const employeeData = employeesList.find(e => e.email.toLowerCase() === email.toLowerCase()) || {
            designation: "Consultant",
            phone: "+1 000 000 0000"
        };

        // 3. Fetch banner config
        const bannerResponse = await fetch(SHAREPOINT_BANNER_CONFIG_URL, fetchOptions);
        const bannerConfig = await bannerResponse.json();

        // 4. Fetch the actual banner image and base64 encode it 
        // This freezes the image inside the email so old campaigns don't bleed into old emails
        const imgResponse = await fetch(bannerConfig.banner_image_url, fetchOptions);
        const imageBlob = await imgResponse.blob();

        const base64Image = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(imageBlob);
        });

        // 5. Construct the HTML Signature
        const signatureHtml = `
            <br/><br/>
            <div style="font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #444;">
                <p style="margin: 0; padding: 0;"><strong>${name}</strong></p>
                <p style="margin: 0; padding: 0; color: #005A9E;">${employeeData.designation} | UVID Consulting</p>
                <p style="margin: 0; padding: 0;">M: ${employeeData.phone} | E: <a href="mailto:${email}" style="color: #005A9E;">${email}</a></p>
                <p style="margin-top: 10px;">
                    <a href="${bannerConfig.target_link}">
                        <img src="${base64Image}" alt="${bannerConfig.alt_text}" style="max-width: 450px; height: auto; border-radius: 4px;"/>
                    </a>
                </p>
            </div>
        `;

        // 6. Insert into Outlook
        Office.context.mailbox.item.body.setSignatureAsync(
            signatureHtml,
            { coercionType: Office.CoercionType.Html },
            function (asyncResult) {
                if (asyncResult.status === Office.AsyncResultStatus.Failed) {
                    console.error("Signature injection failed: " + asyncResult.error.message);
                }
                // Inform Outlook the event is complete, allowing the user to type
                event.completed({ allowEvent: true });
            }
        );
    } catch (error) {
        console.error("Error generating UVID signature: ", error);
        // Fail gracefully, ensure the user can still write their email
        event.completed({ allowEvent: true });
    }
}

// Map the function so the manifest can find it
Office.actions.associate("onMessageComposeHandler", onMessageComposeHandler);
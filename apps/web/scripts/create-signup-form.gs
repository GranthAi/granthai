/**
 * Creates the GranthAi signup Google Form (same questions as the old Tally form) and a
 * Google Sheet that collects its responses, in whichever Google account runs it.
 *
 * 1. Open https://script.google.com while signed in as the account that should own the form
 * 2. New project -> replace the code with this file -> Save
 * 3. Select createSignupForm -> Run -> allow the permissions it asks for
 * 4. Copy the "Embed URL" from the execution log
 */
function createSignupForm() {
	const form = FormApp.create("Use GranthAi without limits");
	form
		.setDescription("Get updates on GranthAi: automatic API docs and MCP servers from your live API traffic.")
		.setProgressBar(false)
		.setShowLinkToRespondAgain(false)
		.setAllowResponseEdits(false)
		.setConfirmationMessage(
			"Thank you for signing up!\n\n" +
				"Add GranthAi to a Node.js app: https://www.npmjs.com/package/granthai\n" +
				"Any other language (Python, Java, Go, PHP...): https://www.npmjs.com/package/granthai-agent"
		);

	form.addTextItem().setTitle("Your name").setHelpText("e.g. Omkar Ajagunde").setRequired(true);

	form
		.addTextItem()
		.setTitle("Your work email")
		.setHelpText("e.g. omkar@granthai.com")
		.setRequired(true)
		.setValidation(FormApp.createTextValidation().setHelpText("Please enter a valid email address").requireTextIsEmail().build());

	form
		.addListItem()
		.setTitle("Where do you want to use this tool?")
		.setChoiceValues(["Personal projects", "Company products"])
		.setRequired(true);

	form
		.addMultipleChoiceItem()
		.setTitle("Which functionality are you interested in?")
		.setChoiceValues([
			"Automatically generate HTTP API documentation",
			"Automatically generate MCP tools for AI agents",
			"Both"
		])
		.setRequired(true);

	form
		.addListItem()
		.setTitle("What best defines your role?")
		.setChoiceValues(["Software development", "Software testing", "Product manager / Project manager", "CEO / CTO / VP / Director"])
		.setRequired(true);

	form
		.addListItem()
		.setTitle("How many APIs do you plan to document?")
		.setChoiceValues(["0 - 10", "10 - 25", "25 - 50", "50 +"])
		.setRequired(true);

	form.addParagraphTextItem().setTitle("How badly do you feel the need for API documentation?");

	const sheet = SpreadsheetApp.create("GranthAi signups");
	form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

	// Forms created from scripts may start unpublished; publish so anyone with the link can respond
	if (typeof form.setPublished === "function") form.setPublished(true);
	form.setAcceptingResponses(true);

	const viewUrl = form.getPublishedUrl();
	Logger.log("Form (edit):   " + form.getEditUrl());
	Logger.log("Responses:     " + sheet.getUrl());
	Logger.log("Embed URL:     " + viewUrl + (viewUrl.indexOf("?") === -1 ? "?embedded=true" : "&embedded=true"));
}

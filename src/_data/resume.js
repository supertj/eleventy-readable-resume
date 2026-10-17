import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import markdownIt from "markdown-it";

// The content sits in the project root so it's the first thing people find.
// eleventy.config.js watches it, and Eleventy calls this function on every
// rebuild, so edits show up while `npm start` is running.
const RESUME_FILE = "resume.yaml";

// Curly quotes and apostrophes, like the original. The other typographer
// replacements are off because they'd turn "Statistics (R)" into "Statistics ®".
const markdown = markdownIt({ typographer: true }).disable("replacements");

// Browsers ignore spaces and control characters when they read a URL's scheme,
// so " java\tscript:" is still JavaScript. Read it with those removed.
const schemeOf = (url) => url.replace(/[\u0000-\u0020\u007f]/g, "").match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();

// Every link except email and phone gets rel="nofollow", here and in the
// contact line. Guessing which URLs leave the site is easy to get wrong
// (browsers read \\example.com as //example.com), so it doesn't try.
// Delete the rel lines if you want search engines to follow your links.
const relFor = (url) => (["mailto", "tel"].includes(schemeOf(url)) ? "" : "nofollow");
const renderLinkOpen = markdown.renderer.rules.link_open ?? ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
	let rel = relFor(tokens[index].attrGet("href") ?? "");
	if (rel) tokens[index].attrSet("rel", rel);
	return renderLinkOpen(tokens, index, options, env, self);
};

// Same page setup as the Google Docs original: 0.6 in margins on US Letter,
// 15 mm on A4. Width and height draw the sheet on screen.
const PAPERS = {
	letter: { size: "letter", width: "8.5in", height: "11in", margin: "0.6in" },
	a4: { size: "A4", width: "210mm", height: "297mm", margin: "15mm" },
};

// Whether an entry has a school, a company or a name decides its layout. These
// match the education(), experience() and activity() helpers in the Typst version.
const ENTRY_KINDS = {
	school: {
		fields: ["school", "location", "degree", "date"],
		// School and location, then degree and dates in italics
		rows: (entry) => [
			[tag("strong", entry.school), inline(entry.location)],
			[tag("em", entry.degree), tag("em", entry.date)],
		],
	},
	company: {
		fields: ["company", "location", "title", "date"],
		// Company and location, then the job title in italics with the dates
		rows: (entry) => [
			[tag("strong", entry.company), inline(entry.location)],
			[tag("em", entry.title), inline(entry.date)],
		],
	},
	name: {
		fields: ["name", "role", "date"],
		// One line: "Name | Role" with the dates on the right
		rows: (entry) => [
			[[tag("strong", entry.name), tag("em", entry.role)].filter(Boolean).join(" | "), inline(entry.date)],
		],
	},
};

const filled = (value) => value != null && value !== "";
const isMapping = (value) => value != null && typeof value === "object" && !Array.isArray(value);

// A misspelled key would otherwise vanish from the page without a word.
function checkKeys(object, allowed, where) {
	for (let key of Object.keys(object)) {
		if (!allowed.includes(key)) {
			throw new Error(`${RESUME_FILE}: unknown field "${key}" in ${where}. Expected one of: ${allowed.join(", ")}.`);
		}
	}
}

function checkText(value, where) {
	if (typeof value === "string") return value;
	// YAML reads `- GPA: 3.8` as a key and a value, not as a line of text
	if (isMapping(value)) {
		let [key] = Object.keys(value);
		throw new Error(`${RESUME_FILE}: "${key}: ..." in ${where} was read as a field, not text. Put the whole line in quotes.`);
	}
	throw new Error(`${RESUME_FILE}: expected text in ${where}.`);
}

function inline(value, where = "an entry") {
	return filled(value) ? markdown.renderInline(checkText(value, where)) : "";
}

function tag(name, value) {
	let html = inline(value);
	return html ? `<${name}>${html}</${name}>` : "";
}

// An empty list item is usually a line starting with #, which YAML reads as a comment
function required(value, where) {
	if (!filled(value)) throw new Error(`${RESUME_FILE}: empty line in ${where}. If it starts with #, put it in quotes.`);
	return value;
}

function list(value, where) {
	if (value == null) return [];
	if (!Array.isArray(value)) throw new Error(`${RESUME_FILE}: ${where} should be a list, one "- " per line.`);
	return value;
}

const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const SAFE_SCHEMES = ["http", "https", "mailto", "tel"];

function checkUrl(url) {
	let scheme = schemeOf(url);
	if (scheme && !SAFE_SCHEMES.includes(scheme)) {
		throw new Error(`${RESUME_FILE}: links in the contact line can start with ${SAFE_SCHEMES.join(":, ")}:, not "${scheme}:".`);
	}
	return url;
}

// Emails and full web addresses become links; anything else is plain text.
function contactItem(item) {
	if (isMapping(item)) {
		checkKeys(item, ["text", "url"], "a contact item");
		let url = filled(item.url) ? checkUrl(checkText(item.url, "a contact url")) : undefined;
		if (!url) return { html: inline(item.text, "a contact item") };
		// Plain text inside the link: a Markdown link here would nest one link in another
		return { html: markdown.utils.escapeHtml(checkText(item.text ?? url, "a contact item")), url, rel: relFor(url) };
	}
	let text = checkText(item, "the contact line");
	let url;
	if (/^https?:\/\//.test(text)) url = text;
	else if (text.startsWith("mailto:")) [url, text] = [text, text.slice(7)];
	else if (EMAIL.test(text)) url = `mailto:${text}`;
	return url ? { html: markdown.utils.escapeHtml(text), url, rel: relFor(url) } : { html: inline(text) };
}

function entry(item, section) {
	let where = `an entry under "${section}"`;
	if (!isMapping(item)) throw new Error(`${RESUME_FILE}: ${where} should be a set of fields like "company: ...", not a single line.`);
	let kind = ENTRY_KINDS[Object.keys(ENTRY_KINDS).find((key) => key in item)];
	if (!kind && Object.keys(item).some((key) => key !== "bullets")) {
		throw new Error(`${RESUME_FILE}: ${where} needs a school, company or name field to say how it's laid out.`);
	}
	checkKeys(item, [...(kind?.fields ?? []), "bullets"], where);
	let rows = kind ? kind.rows(item).filter(([left, right]) => left || right) : [];
	let bullets = list(item.bullets, `"bullets" in ${where}`).map((bullet) => {
		let bulletsWhere = `the bullets under "${section}"`;
		return inline(required(bullet, bulletsWhere), bulletsWhere);
	});
	return { rows, bullets };
}

function line(item, section) {
	let where = `the lines under "${section}"`;
	// `- Languages: French` is a label and its text, set as "**Languages:** French"
	if (isMapping(item)) {
		return Object.entries(item)
			.map(([label, text]) => `<strong>${inline(label, where)}:</strong> ${inline(text, where)}`)
			.join("<br>");
	}
	return inline(required(item, where), where);
}

function section(item) {
	if (!isMapping(item)) throw new Error(`${RESUME_FILE}: each section needs a title, like "- title: Experience".`);
	checkKeys(item, ["title", "text", "entries", "lines"], "a section");
	let title = checkText(item.title ?? "", "a section title");
	return {
		title: inline(title),
		text: filled(item.text) ? markdown.render(checkText(item.text, `the text under "${title}"`)) : "",
		entries: list(item.entries, `"entries" under "${title}"`).map((entryItem) => entry(entryItem, title)),
		lines: list(item.lines, `"lines" under "${title}"`).map((lineItem) => line(lineItem, title)),
	};
}

export default function () {
	// FAILSAFE keeps every value as typed: "3.80" stays 3.80, "Yes" stays Yes
	// and 2024-05-01 doesn't turn into a date object.
	let resume = yaml.load(readFileSync(RESUME_FILE, "utf8"), { schema: yaml.FAILSAFE_SCHEMA }) ?? {};
	if (!isMapping(resume)) throw new Error(`${RESUME_FILE} should start with fields like "name: ...".`);
	checkKeys(resume, ["name", "contact", "paper", "description", "sections"], "the top level");

	let paperName = checkText(resume.paper ?? "letter", "paper").toLowerCase();
	let paper = Object.hasOwn(PAPERS, paperName) ? PAPERS[paperName] : undefined;
	if (!paper) throw new Error(`${RESUME_FILE}: paper should be letter or a4, not "${resume.paper}".`);

	return {
		name: checkText(resume.name ?? "", "name"),
		description: checkText(resume.description ?? "", "description"),
		contact: list(resume.contact, "contact").filter(filled).map(contactItem).filter((item) => item.html),
		paper,
		sections: list(resume.sections, "sections").map(section),
	};
}

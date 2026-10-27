export function normalizeAnswer(value) {
    return String(value ?? "")
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .replace(/[\p{White_Space}\p{P}\p{S}]/gu, "");
}

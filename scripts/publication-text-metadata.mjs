import { appUrl } from './publication-urls.mjs';

function replacePublishedSiteUrl(value, publicationUrl) {
  const siteUrl = appUrl();
  const parsedSiteUrl = new URL(siteUrl);
  const placeholders = [siteUrl, parsedSiteUrl.origin, parsedSiteUrl.host]
    .sort((left, right) => right.length - left.length);
  const marker = '@@MATLAS_PUBLICATION_URL@@';
  let result = value;
  let replaced = false;

  for (const placeholder of placeholders) {
    if (!result.includes(placeholder)) continue;
    result = result.replaceAll(placeholder, marker);
    replaced = true;
  }

  return replaced
    ? result.replaceAll(marker, publicationUrl)
    : `${result} ${publicationUrl}`;
}

export function attributionForTextPublication(graphData, pathname) {
  const configuredAttribution = String(graphData.meta.attribution ?? '').trim();
  if (!configuredAttribution) throw new Error('Published text requires graphData.meta.attribution.');
  return replacePublishedSiteUrl(configuredAttribution, appUrl(pathname));
}

export function appendTextPublicationMetadata(content, graphData, pathname, { licenseUrl: configuredLicenseUrl } = {}) {
  const licenseUrl = String(configuredLicenseUrl ?? graphData.meta.licenseUrl ?? '').trim();
  if (!licenseUrl) throw new Error('Published text requires graphData.meta.licenseUrl.');
  const attribution = attributionForTextPublication(graphData, pathname);
  return [
    String(content).trimEnd(),
    '',
    '## License and attribution',
    '',
    `License URL: ${licenseUrl}`,
    '',
    attribution,
    ''
  ].join('\n');
}

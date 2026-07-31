import { spawnSync } from 'node:child_process';

export function formatIsoTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
  return date.toISOString();
}

export function parseBlamePorcelain(output) {
  const blamedLines = [];
  const lines = output.split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    if (line.startsWith('\t')) {
      if (current) {
        current.lineContent = line.slice(1);
        blamedLines.push(current);
        current = null;
      }
      continue;
    }

    const headerMatch = /^([0-9a-f]{7,40})\s+\d+\s+\d+\s+\d+/.exec(line);
    if (headerMatch) {
      if (current) {
        blamedLines.push(current);
      }
      current = {
        commitHash: headerMatch[1],
        authorTime: undefined,
        lineContent: ''
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith('author-time ')) {
      current.authorTime = Number(line.slice(12));
      continue;
    }

    if (line.startsWith('committer-time ') && current.authorTime == null) {
      current.authorTime = Number(line.slice(15));
      continue;
    }
  }

  if (current) {
    blamedLines.push(current);
  }

  return blamedLines;
}

export function buildConceptTimestampMap(blamedLines) {
  const timestamps = new Map();

  for (const entry of blamedLines) {
    if (!entry || typeof entry.lineContent !== 'string' || !Number.isFinite(entry.authorTime)) {
      continue;
    }
    const match = /^\s*-?\s*id:\s*([^\s#]+)\s*(?:#.*)?$/.exec(entry.lineContent);
    if (!match) {
      continue;
    }

    const conceptId = match[1].trim();
    const timestamp = formatIsoTimestamp(new Date(entry.authorTime * 1000));
    const previous = timestamps.get(conceptId);
    if (!previous || timestamp > previous) {
      timestamps.set(conceptId, timestamp);
    }
  }

  return timestamps;
}

function buildDomainLastModified(blamedLines) {
  let mostRecent = 0;
  for (const entry of blamedLines) {
    if (!entry || !Number.isFinite(entry.authorTime)) {
      continue;
    }
    mostRecent = Math.max(mostRecent, entry.authorTime);
  }
  return mostRecent > 0 ? formatIsoTimestamp(new Date(mostRecent * 1000)) : undefined;
}

export function getFileLastModifiedData(filePath, rootPath) {
  try {
    const git = spawnSync('git', ['blame', '--line-porcelain', '--', filePath], {
      cwd: rootPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (git.status !== 0 || !git.stdout) {
      return { domainLastModified: undefined, conceptLastModified: new Map() };
    }

    const blamedLines = parseBlamePorcelain(git.stdout);
    return {
      domainLastModified: buildDomainLastModified(blamedLines),
      conceptLastModified: buildConceptTimestampMap(blamedLines)
    };
  } catch {
    return { domainLastModified: undefined, conceptLastModified: new Map() };
  }
}

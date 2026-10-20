import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/domain/model';
import { downloadsRelativePath, folderSegments } from '../../src/shared/files';

describe('category folders', () => {
  it('saves into IDM-style category folders inside Downloads by default', () => {
    expect(downloadsRelativePath('setup.zip', defaultSettings)).toBe('Compressed/setup.zip');
    expect(downloadsRelativePath('movie.mkv', defaultSettings)).toBe('Video/movie.mkv');
    expect(downloadsRelativePath('app.exe', defaultSettings)).toBe('Programs/app.exe');
    expect(downloadsRelativePath('notes.unknown', defaultSettings)).toBe('General/notes.unknown');
  });
  it('applies the subfolder and renamed category folders', () => {
    const settings = {
      ...defaultSettings,
      downloadsSubfolder: 'Flux/All',
      categoryFolders: { ...defaultSettings.categoryFolders, Archives: 'Zips' },
    };
    expect(downloadsRelativePath('a.rar', settings)).toBe('Flux/All/Zips/a.rar');
  });
  it('skips the category folder when disabled', () => {
    expect(downloadsRelativePath('a.pdf', { ...defaultSettings, saveByCategory: false })).toBe(
      'a.pdf',
    );
  });
  it('never escapes the Downloads folder', () => {
    expect(folderSegments('../..\\x/./y:z')).toEqual(['x', 'y_z']);
    expect(
      downloadsRelativePath('../evil.zip', { ...defaultSettings, downloadsSubfolder: '/../..' }),
    ).toBe('Compressed/_evil.zip');
  });
});

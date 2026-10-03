-- Rename aspects from color names to meaningful labels.
UPDATE domains SET title = 'Body'        WHERE title = 'Red'    AND subtype = 'aspect';
UPDATE domains SET title = 'Connections' WHERE title = 'Purple' AND subtype = 'aspect';
UPDATE domains SET title = 'Growth'      WHERE title = 'Green'  AND subtype = 'aspect';
UPDATE domains SET title = 'Duty'        WHERE title = 'Blue'   AND subtype = 'aspect';
UPDATE domains SET title = 'Flow'        WHERE title = 'Gray'   AND subtype = 'aspect';
UPDATE domains SET title = 'Self'        WHERE title = 'Steel'  AND subtype = 'aspect';

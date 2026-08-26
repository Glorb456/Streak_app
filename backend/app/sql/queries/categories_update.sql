UPDATE categories
SET name = $2, color = $3
WHERE id = $1
RETURNING id, name, color, position;

INSERT INTO categories (name, color, position)
VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM categories), 0))
RETURNING id, name, color, position;

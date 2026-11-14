const response = http.post(`${ORIGIN}${ROUTE}`, {
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'X-Fixture-Control': CONTROL,
    'Content-Type': 'application/json',
  },
  body: BODY,
});
if (response.status >= 300)
  throw new Error(`${ROUTE} failed with HTTP ${response.status}: ${response.body}`);

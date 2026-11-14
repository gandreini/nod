const response = http.get(`${ORIGIN}/fixture/counts`, {
  headers: { Authorization: `Bearer ${TOKEN}`, 'X-Fixture-Control': CONTROL },
});
if (response.status !== 200)
  throw new Error(`Counts failed with HTTP ${response.status}: ${response.body}`);
output.counts = json(response.body);

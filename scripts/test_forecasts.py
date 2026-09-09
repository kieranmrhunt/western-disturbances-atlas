#!/usr/bin/env python3
"""Numerical tests and real-run publication validation (no network)."""
import gzip
import json
from pathlib import Path
import unittest
import numpy as np
import build_forecasts as f

class NumericalTests(unittest.TestCase):
    def test_solid_body_rotation(self):
        omega=1e-5
        u=np.broadcast_to(omega*6371000*np.cos(np.deg2rad(f.LAT))[:,None],(len(f.LAT),len(f.LON)))
        result=f.vorticity(u,np.zeros_like(u))
        expected=np.broadcast_to(2*omega*np.sin(np.deg2rad(f.LAT))[:,None],result.shape)
        np.testing.assert_allclose(result[3:-3],expected[3:-3],atol=2e-9)
    def test_t42_constant_and_degree_one(self):
        a=np.broadcast_to(np.sin(np.deg2rad(f.LAT))[:,None],(len(f.LAT),len(f.LON)))
        np.testing.assert_allclose(f.t42(a),a,atol=1e-10)
        np.testing.assert_allclose(f.t42(np.ones_like(a)),1,atol=1e-10)
    def test_precipitation_windows(self):
        def frame(h,r,span):return {'step':h,'precipitation':None if r is None else np.array([float(r)]),'accumulation':span}
        a=[frame(0,None,None),frame(6,3,[0,6]),frame(12,8,[0,12]),frame(18,4,[12,18])]
        values=f.six_hour_precipitation(a)
        self.assertIsNone(values[0]); self.assertEqual([x.item() for x in values[1:]],[3,5,4])
        with self.assertRaises(ValueError): f.six_hour_precipitation([a[0],frame(6,3,[3,6])])
        with self.assertRaises(ValueError): f.six_hour_precipitation([a[0],a[1],frame(12,1,[0,12])])
    def test_existing_member_runs(self):
        paths=list((f.ROOT/'forecast-data/runs').glob('*.json.gz'))
        self.assertGreater(len(paths),0)
        for path in paths:
            with self.subTest(run=path.name):
                p=json.loads(gzip.decompress(path.read_bytes()))
                self.assertTrue(f.validate(p)['complete'])

if __name__=='__main__': unittest.main()

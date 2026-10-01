import json
import os
_HERE=os.path.dirname(os.path.abspath(__file__))
def _data(name): return os.path.join(_HERE,"data",name)
# fictional business-register series: registered small field-service firms, by year
pts=[(2019,13120),(2021,13350),(2022,13740),(2023,14260)]
(y0,v0),(y1,v1)=pts[0],pts[-1]
cagr=(v1/v0)**(1/(y1-y0))-1
target=2026; ext=v1*(1+cagr)**(target-y1)
line=[(y0,v0),(target, round(ext))]
json.dump({"points":pts,"cagr":cagr,"target":target,"extrapolated":round(ext),"line":line},open(_data("ts_curve.json"),"w"))
print("CAGR %.4f (%.1f%%/yr); extrapolate to %d = %.0f"%(cagr,cagr*100,target,ext))
